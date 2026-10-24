// 卡片浏览界面（v19 Anki 式改造）：全量卡片表格 + 搜索/类型/状态筛选 + 排序 + 行详情维护。
// 浏览器式操作（对齐 Anki 浏览器，基于本库数据）：卡面预览与内联编辑（复用复习页 CardFace/EditableText）、
// 暂停/恢复、推迟、重置为新卡、删除、跳转原文、质检问题（CardIssue）查看、Leech 六步向导入口。
// 评分调度仍在连续刷题界面（ReviewView），此处不写复习日志。
// v48.67（D111 §6.8-6 数据通道）：主进程过滤 + 分页取数——全量 cards:listAll 消费退役：
// 轻量行集（meta/ids）承载排序/预设/页签/锚点闭包/按书 scope，行窗口（cards:getWindow）按需取全行，
// 含查询条件的查询由主进程求值（cards:queryIds，求值引擎与渲染层同一份 cardQuery 单源产物）。
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isImeComposing } from "../lib/ime";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { parseCloze, extractClozeAnswers, cardsApi, hasSourceAnchor, type CardRecord, type CardIssueRecord, type CardGenInfo, type TodayQueue, type BrowserMetaRow } from "../lib/cards";
import { playVocabAudio } from "../lib/dictClient";
import { eventBus } from "../lib/eventbus";
import DisambiguateModal from "./DisambiguateModal";
import RegenCardsModal from "./RegenCardsModal";
import Dropdown from "./Dropdown";
import OcclusionShapes from "./OcclusionShapes";
import ImageLightbox from "./ImageLightbox";
import { IconVolume, IconChevronDown } from "./icons";
import { useDialogA11y } from "../lib/dialogA11y";
import KnowledgeManager from "./KnowledgeManager";
// v48.61（D103）：血缘树纯函数（D87 邻接表口径 + D85 聚合计数，复用零新写路径）
import { buildLineageTree, type LineageExtractRow, type LineageNode } from "../lib/cardLineage";
// v48.61（D104）：背面辅助字段区（app.cardFaceExtras 三开关，与复习页同一组件）
import CardFaceExtrasBlock from "./CardFaceExtras";
// v48.63（D107）：标签功能总开关——批量打标/详情标签区/构建器标签条件受其控制
import { useTagsEnabled } from "../lib/tagSettings";
// v48.22（D58 §6.8-6）：浏览器 2.0——摘录行数据源 + 状态/推送文案
import { readingWorkflow, type DueTopic } from "../lib/readingWorkflow";
import { extractStatusLabel } from "../lib/sessionQueue";
import { nextAtText } from "./ExtractCardFace";
import { settingsStore } from "../lib/settings";
import { parseCardQuery, cardRowMatches, extractRowMatches, extractScopeConditions, extractTagsOf } from "../lib/cardQuery";
// D158：方案条件表格侧过滤（语义与会话组队同源，见 §6.8-5「表格侧语义」）
import { buildSchemeFilter, cardMatchesScheme, extractMatchesScheme } from "../lib/schemeFilter";
// v48.60（D101）：标签——批量打标/去标的终值计算 + 词表建议（规则单一源 = src/lib/tags.ts）
import { applyTagDelta, tagKey, type TagVocabEntry } from "../lib/tags";
import TagInput from "./TagInput";
import { t, useT } from "../lib/i18n";

/** v48.22（D58 §6.8-5）：筛选牌组（复习范围）——保存的过滤条件，零 schema 变更。
 *  v48.61（D105）：结构扩展 tags[] / kpIds[]（向后兼容，缺省 = 不限）；过滤语义见 §6.8-5 */
interface SavedScope {
  id: string;
  name: string;
  bookItemIds: string[];
  tags?: string[];
  kpIds?: string[];
  kinds: string[];
  limits?: unknown;
}

type Preset = "all" | "due" | "leech" | "deferred" | "knowledge" | "archived";
type BrowserCard = CardRecord & { docTitle?: string };
type JumpToDoc = (
  docId: string,
  anchor: { anchorText: string; anchorRatio?: number; cfi?: string; chapterIndex?: number; pageIndex?: number; imageAnchor?: { alt?: string; contextText?: string }; occlusion?: { rects: { x: number; y: number; w: number; h: number; ord: number }[]; shapes?: unknown; regionScope?: string; cardOrd?: number; assetPath?: string } },
  returnTo?: "review" | "queue" | "browse"
) => void;

const TYPE_LABELS: Record<string, string> = {
  qa: "问答",
  cloze: "填空",
  seq: "背诵",
  imageOcclusion: "遮挡",
  application: "应用",
  mnemonic: "助记",
  formula: "公式"
};
const typeLabel = (k: string) => t(TYPE_LABELS[k]) || k;

const STATE_LABELS: Record<string, string> = { new: "新卡", learning: "学习中", relearning: "学习中", review: "复习中" };

function statusOf(c: CardRecord): string {
  // v48.60（D102）：生命周期归档最先可见（与挂起正交——归档 + 挂起显示「已归档」，挂起态在详情/meta 可见）
  if ((c as { status?: string | null }).status === "archived") return t("已归档");
  if (c.leech?.suspended) return t("已暂停");
  const s = STATE_LABELS[c.fsrs?.state ?? "new"];
  return s ? t(s) : t("复习中");
}

// 到期判定与难点口径（v48.67 / D111 起内联在轻量行集过滤器中，字段口径不变：
// 到期＝未挂起且 due≤now（fsrs 缺失视为 due=now）；难点＝isLeech 或已暂停）

function formatDue(ms: number): string {
  const days = ms / 86400000;
  if (days < 1 / 24) return `${Math.max(1, Math.round(ms / 60000))} ${t("分钟")}`;
  if (days < 1) return `${Math.round(days * 24)} ${t("小时")}`;
  if (days < 30) return `${Math.round(days)} ${t("天", { n: Math.round(days) })}`;
  if (days < 365) return `${(days / 30).toFixed(1)} ${t("个月")}`;
  return `${(days / 365).toFixed(1)} ${t("年")}`;
}

function dueText(c: CardRecord): string {
  if (c.leech?.suspended) return "—";
  const due = c.fsrs?.due;
  if (!due) return "—";
  const diff = due - Date.now();
  return diff <= 0 ? t("已到期") : formatDue(diff);
}

// 浏览列表显示完整原文（挖空内容可见，Anki 浏览器同语义）；图片挖空带标记前缀
function frontPreview(c: CardRecord): string {
  const text = c.frontMarkdown || c.noteText;
  if (c.cardType === "imageOcclusion") return t("[图片遮挡] {text}", { text });
  if (c.cardType === "cloze") return parseCloze(text).render(null);
  return text;
}

// 来源展示：书名可能自带《》（导入时保留原书名），已带则不再包一层
// 与主进程 electron/db.js 的 foldSearch **逐字一致**（渲染层与主进程无法共享模块，
// 靠 F79「两条检索路径命中集必须相同」这条闸门守着）。D-TEST-84：原来这里是
// query.trim().toLowerCase()，少了 NFKC 这一步，于是同一个词在卡片浏览与日记/知识点给出不同结果。
const foldSearch = (s: unknown) => String(s ?? "").normalize("NFKC").trim().toLowerCase();

// D110：Chromium 单滚动容器 scrollHeight 硬上限 ≈ 13.42M px（实测钳制值 13,421,773）——
// 虚拟滚动 spacer 总高超限时按比例压缩（见 recomputeWindows 内注释）
const SCROLL_CAP = 13_000_000;

// v48.67（D111）：渲染层全行缓存上限——行窗口按需取，深滚动不无限累积（超出按插入序淘汰，未命中再取）
const ROW_CACHE_MAX = 4000;
// v48.67（D111）：难点页签旧列表视图未纳入虚拟滚动（queue-row 变高不可窗口化），按主进程分页列前 200 行
const LEECH_LIST_CAP = 200;

// v48.67（D111）：单侧视图的空列表必须是稳定身份——每次渲染新建 [] 会让 recomputeWindows 的
// useCallback 依赖永远变化 ⇒ 每渲染 setWin(新对象) ⇒ 无限重渲染（D110 埋下的雷：同步行数据时代价
// 隐蔽，异步行取数把它放大为 getWindow + 行缓存拷贝风暴）。setWin 另做等值短路双保险。
const EMPTY_META: BrowserMetaRow[] = [];
const EMPTY_EXTRACTS: DueTopic[] = [];

function pruneRowCache(m: Map<string, BrowserCard>): Map<string, BrowserCard> {
  while (m.size > ROW_CACHE_MAX) {
    const first = m.keys().next().value;
    if (first === undefined) break;
    m.delete(first);
  }
  return m;
}

function srcLabel(c: CardRecord & { docTitle?: string }): string {
  const t = c.docTitle || c.sourceRef?.title || "";
  if (!t) return "—";
  return t.startsWith("《") ? t : `《${t}》`;
}

export default function CardBrowser({
  onJumpToDoc,
  onStartSession,
  anchorExtractId,
  onClearAnchorFilter
}: {
  onJumpToDoc?: JumpToDoc;
  /** v48.22（D58 §6.8-5）：从筛选牌组进入「集中复习」（按范围开会话；App 负责路由） */
  onStartSession?: (scope: { bookItemIds: string[]; tags?: string[]; kpIds?: string[]; kinds: string[]; name: string; limits?: Record<string, number> | null }) => void;
  /**
   * v48.47（D87）：**锚点筛选**——只显示归属于该高亮锚的条目（锚摘录自身 + 全部子孙摘录，
   * 闪卡按 `contextRef.extractId ∈ 闭包`、摘录按 `id ∈ 闭包`）；由点击浮窗「已制卡 N 张」进入。
   */
  anchorExtractId?: string | null;
  /** 清除锚点筛选（回 App 摘掉视图字段） */
  onClearAnchorFilter?: () => void;
}) {
  const T = useT();
  const tagsEnabled = useTagsEnabled();
  // v48.67（D111）：全库轻量行集（cards:listMeta，无题面/答案大列）——排序/预设/页签/计数的数据面
  const [metaAll, setMetaAll] = useState<BrowserMetaRow[]>([]);
  // v48.67（D111）：含查询条件的查询的主进程求值结果（cards:queryIds）；null = 无 AST（直接用 metaAll）
  const [queryMeta, setQueryMeta] = useState<BrowserMetaRow[] | null>(null);
  // v48.67（D111）：全行缓存（行窗口 cards:getWindow 按需取；库指纹变化即整体清空）
  const [rowCache, setRowCache] = useState<Map<string, BrowserCard>>(new Map());
  const fpRef = useRef("");
  const [preset, setPreset] = useState<Preset>("all");
  const [query, setQuery] = useState("");
  // D110：输入防抖——30 万行下全量过滤每键 1s+ 会卡输入；输入框即时回显，过滤用 300ms 防抖值
  const [queryInput, setQueryInput] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQuery(queryInput), 300);
    return () => clearTimeout(t);
  }, [queryInput]);
  const [typeFilter, setTypeFilter] = useState("all");
  const [stateFilter, setStateFilter] = useState("all");
  // v46（M14-UM2，§6.7.3）：「记忆接地」筛选（情境来自记忆的卡，含存疑）
  const [memFilter, setMemFilter] = useState(false);
  const [sortBy, setSortBy] = useState("due");
  const [detailId, setDetailId] = useState<string | null>(null);
  // v48.40（D80）：摘录详情——摘录行普通点击打开（与闪卡行同语义；Ctrl/Shift 仍多选）
  const [extractDetailId, setExtractDetailId] = useState<string | null>(null);
  const [leechTarget, setLeechTarget] = useState<BrowserCard | null>(null);
  const [loaded, setLoaded] = useState(false);
  // v34（M12，§4.16）：今日同源暂缓清单（与复习队列同一视图口径）——id → 延后原因
  const [deferredMap, setDeferredMap] = useState<Map<string, NonNullable<TodayQueue["deferred"][number]["deferReason"]>>>(new Map());
  // v48.22（D58 §6.8-6）：浏览器 2.0——统一数据源（闪卡 + 摘录）、多选/全选/反选、批量、按书分组
  const [kindFilter, setKindFilter] = useState<"card" | "extract" | "both">("card");
  const [extracts, setExtracts] = useState<DueTopic[]>([]);
  const [selCards, setSelCards] = useState<Set<string>>(new Set());
  const [selExtracts, setSelExtracts] = useState<Set<string>>(new Set());
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [bookScope, setBookScope] = useState<string>("all");
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchNote, setBatchNote] = useState<string | null>(null);
  // v48.60（D101）：批量打标/去标浮层（v1 仅闪卡行；摘录标签走批注编辑既有入口）+ 词表建议
  const [tagPop, setTagPop] = useState<null | "add" | "remove">(null);
  const [tagDraft, setTagDraft] = useState<string[]>([]);
  const [tagVocab, setTagVocab] = useState<TagVocabEntry[]>([]);
  // v48.22（D58 §6.8-5）：筛选牌组（复习范围）——存 settings.app.reviewScopes，零 schema 变更（D51 先例）
  const [scopes, setScopes] = useState<SavedScope[]>([]);
  const [deckName, setDeckName] = useState("");
  // 上限覆写（§6.8-5：范围只能收紧、不能另开预算；0 = 继承全局）
  const [deckCapExtracts, setDeckCapExtracts] = useState(0);
  const [deckCapNewCards, setDeckCapNewCards] = useState(0);
  // v48.61（D105）：条件构建器——书多选 + 标签多选（词表建议）+ 知识点多选（KnowledgeBase 检索口径）
  const [deckBuilderOpen, setDeckBuilderOpen] = useState(false);
  const [deckExtraBooks, setDeckExtraBooks] = useState<string[]>([]);
  const [deckTags, setDeckTags] = useState<string[]>([]);
  const [deckKps, setDeckKps] = useState<Array<{ id: string; label: string }>>([]);
  const [deckBookPop, setDeckBookPop] = useState(false);
  const [deckKpPop, setDeckKpPop] = useState(false);
  const [kpQuery, setKpQuery] = useState("");
  const [kpOptions, setKpOptions] = useState<Array<{ id: string; label: string; status: string; mergedInto: string | null }>>([]);
  // v48.22（D58 §6.8-6 / O-8 裁定）：摘录正文查找替换（仅选中项、仅正文、纯文本，不做正则）
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  // D157：筛选方案（原「筛选牌组」）——入口弹层、创建面板、当前生效方案
  const [schemeMenuOpen, setSchemeMenuOpen] = useState(false);
  const [schemeEditorOpen, setSchemeEditorOpen] = useState(false);
  const [activeSchemeId, setActiveSchemeId] = useState<string | null>(null);
  const [activeSchemeSig, setActiveSchemeSig] = useState<string>("");
  const [sigCaptureToken, setSigCaptureToken] = useState(0);
  const editorSnapshotRef = useRef<{ books: string[]; tags: string[]; kps: { id: string; label: string }[] } | null>(null);
  const schemeWrapRef = useRef<HTMLSpanElement>(null);

  // D157：当前浏览器筛选的签名——用于判断「方案：X」是否已被用户改动
  const filterSig = JSON.stringify([
    kindFilter,
    bookScope,
    query.trim(),
    [...deckExtraBooks].sort(),
    [...deckTags].sort(),
    deckKps.map((k) => k.id).sort()
  ]);
  // 套用/保存后，在新状态提交后的下一次 effect 里抓取签名
  useEffect(() => {
    if (sigCaptureToken > 0) setActiveSchemeSig(filterSig);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sigCaptureToken]);
  const activeScheme = scopes.find((s) => s.id === activeSchemeId) ?? null;
  const activeModified = !!activeScheme && activeSchemeSig !== "" && activeSchemeSig !== filterSig;

  // D157：弹层关闭（外部点击 / Esc）——useDismiss 是模态两步走 hook，不适用此处（v2 §6.7 核对）
  useEffect(() => {
    if (!schemeMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (schemeWrapRef.current && !schemeWrapRef.current.contains(e.target as Node)) setSchemeMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (isImeComposing(e)) return; // 组字中的 Esc 属于输入法（取消组字），不收菜单
      if (e.key === "Escape") setSchemeMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [schemeMenuOpen]);

  const refresh = useCallback(async () => {
    // v48.67（D111）：meta/ids 主进程通道（库指纹变化时清全行缓存）；全量 listAll 退役。
    // 首屏关键路径只保留 listMeta——摘录表与今日暂缓不阻塞闪卡行渲染（30 万量级实测：
    // deferredToday 背后的 computeTodayQueue 是主进程 10–20s 的同步块，await 它会把
    // 行窗口取数的 IPC 压在其后，首屏被拖到 ~28s；摘出后首屏 ≈ meta 构建 + 一次窗口取数）。
    try {
      const res = await cardsApi.listMeta();
      if (res.fp !== fpRef.current) {
        fpRef.current = res.fp;
        setRowCache(new Map());
      }
      setMetaAll(res.meta);
    } catch {
      setMetaAll([]);
    }
    try {
      const saved = await settingsStore.get<SavedScope[]>("app", "reviewScopes", []);
      setScopes(Array.isArray(saved) ? saved.filter((s) => s && typeof s.id === "string") : []);
    } catch {
      setScopes([]);
    }
    setLoaded(true);
    // 摘录行与今日暂缓（id + 延后原因）脱离首屏关键路径，完成即各自落位
    readingWorkflow
      .getAllTopics()
      .then((topics) => setExtracts(topics as DueTopic[]))
      .catch(() => setExtracts([]));
    // v48.67（D111）：今日暂缓只取 id + 延后原因（cards:deferredToday）——不再全量消费 todayQueue 卡行
    cardsApi
      .deferredToday()
      .then((d) => setDeferredMap(new Map((d ?? []).map((x) => [x.id, x.deferReason]))))
      .catch(() => setDeferredMap(new Map()));
  }, []);

  useEffect(() => {
    refresh();
    return eventBus.on("cards/changed", refresh);
  }, [refresh]);

  // v48.67（D111）：查询主进程求值——含 AST 的查询走 cards:queryIds（与渲染层同一份单源产物）；
  // 无 AST（空查询）不发起 IPC，直接用全库轻量行集（D110「无条件跳过逐行求值」的通道版）。
  useEffect(() => {
    const parsed = parseCardQuery(query);
    if (!parsed.ast) {
      setQueryMeta(null);
      return;
    }
    let cancelled = false;
    cardsApi
      .queryIds(query)
      .then((res) => {
        if (cancelled) return;
        if (res.fp !== fpRef.current) {
          fpRef.current = res.fp;
          setRowCache(new Map());
        }
        setQueryMeta(res.meta);
      })
      .catch(() => {
        if (!cancelled) setQueryMeta([]);
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  // v48.47（D87）：锚点筛选的**子孙闭包**——锚摘录自身 + 子摘录/子子摘录…全部层级。
  // 邻接表来自 workflow 行的 contextRef.parentExtractId（摘录树）；visited 防脏数据成环。
  // v48.61（D103）：筛选锚改**内部状态**（App prop 变化时同步）——卡详情血缘树「查看卡片」
  // 可在浏览器内就地发起，不必绕道 App 视图字段；清除时仍回调 onClearAnchorFilter 保持 App 侧一致。
  const [anchorFilter, setAnchorFilter] = useState<string | null>(anchorExtractId ?? null);
  useEffect(() => {
    setAnchorFilter(anchorExtractId ?? null);
  }, [anchorExtractId]);
  const clearAnchorFilter = useCallback(() => {
    setAnchorFilter(null);
    onClearAnchorFilter?.();
  }, [onClearAnchorFilter]);

  const anchorClosure = useMemo(() => {
    if (!anchorFilter) return null;
    const parentToChildren = new Map<string, string[]>();
    for (const e of extracts as Array<{ id?: string; contextRef?: { parentExtractId?: string | null } | null }>) {
      const pid = e?.contextRef?.parentExtractId;
      if (pid && e?.id) {
        const list = parentToChildren.get(String(pid)) ?? [];
        list.push(String(e.id));
        parentToChildren.set(String(pid), list);
      }
    }
    const set = new Set<string>([String(anchorFilter)]);
    const stack = [String(anchorFilter)];
    while (stack.length) {
      const cur = stack.pop() as string;
      for (const child of parentToChildren.get(cur) ?? []) {
        if (!set.has(child)) {
          set.add(child);
          stack.push(child);
        }
      }
    }
    return set;
  }, [anchorFilter, extracts]);

  // v48.67（D111）：计数口径与原 isDueCard/isLeechOrSuspended 逐字同源（消费轻量行集字段）
  // v48.111（D156）：补已归档计数——页签直读，纯文字统计行退役
  const counts = useMemo(
    () => ({
      due: metaAll.filter((m) => !m.suspended && (m.due ?? Date.now()) <= Date.now()).length,
      leech: metaAll.filter((m) => m.isLeech || m.suspended).length,
      deferred: metaAll.filter((m) => deferredMap.has(m.id)).length,
      archived: metaAll.filter((m) => m.status === "archived").length
    }),
    [metaAll, deferredMap]
  );

  // v48.111（D156）：知识点页签计数——KnowledgeBase 总数（limit:1 只为取 total；切页签时刷新）
  const [kpTotal, setKpTotal] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    window.knowledgeAPI
      ?.listPoints({ limit: 1 })
      .then((res) => {
        if (!cancelled) setKpTotal(res?.total ?? 0);
      })
      .catch(() => {
        if (!cancelled) setKpTotal(null);
      });
    return () => {
      cancelled = true;
    };
  }, [preset]);

  // 类型筛选项从库内实际存在的类型动态生成（未知类型显示原文）
  const typeOptions = useMemo(() => {
    const present = new Map<string, string>();
    for (const m of metaAll) present.set(m.cardType, typeLabel(m.cardType));
    return [
      { value: "all", label: t("全部类型") },
      ...[...present.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }))
    ];
  }, [metaAll]);

  // v48.67（D111）：字段/文本筛选链拆两层——查询条件在主进程求值（queryMeta），视图侧
  // 预设/类型/状态/锚点闭包/按书/记忆接地消费轻量行集字段（与原 filtered 的字段口径逐字同源）。
  const parsedQuery = useMemo(() => parseCardQuery(query), [query]);
  const filteredMeta = useMemo(() => {
    let list = queryMeta ?? metaAll;
    // v48.60（D102）：已归档默认排除（视图口径）；显式入口＝「已归档」preset / status:archived 查询 / 状态下拉
    const archivedOnly =
      preset === "archived" || parsedQuery.status === "archived" || parsedQuery.status === "已归档" || stateFilter === "archived";
    list = archivedOnly ? list.filter((m) => m.status === "archived") : list.filter((m) => m.status !== "archived");
    if (preset === "due") list = list.filter((m) => !m.suspended && (m.due ?? Date.now()) <= Date.now());
    if (preset === "leech") list = list.filter((m) => m.isLeech || m.suspended);
    if (preset === "deferred") list = list.filter((m) => deferredMap.has(m.id));
    if (typeFilter !== "all") list = list.filter((m) => m.cardType === typeFilter);
    // v48.47（D87）：锚点筛选——卡挂在闭包内摘录上（轻量行集自带 extractId）
    if (anchorClosure) list = list.filter((m) => anchorClosure.has(String(m.extractId || "")));
    if (memFilter) list = list.filter((m) => !!m.mem);
    if (stateFilter !== "all") {
      list = list.filter((m) => {
        if (stateFilter === "archived") return m.status === "archived";
        if (stateFilter === "suspended") return m.suspended;
        if (m.suspended) return false;
        const s = m.fsrsState ?? "new";
        return stateFilter === "learning" ? s === "learning" || s === "relearning" : s === stateFilter;
      });
    }
    return list;
  }, [queryMeta, metaAll, preset, parsedQuery, typeFilter, stateFilter, memFilter, deferredMap, anchorClosure]);

  const sortedMeta = useMemo(() => {
    const s = [...filteredMeta];
    // 排序语义与原实现同源：到期升序用 ?? 0（新卡沉底）、优先级/遗忘降序、创建时间降序
    if (sortBy === "created") s.sort((a, b) => b.createdAt - a.createdAt);
    else if (sortBy === "priority") s.sort((a, b) => (b.priority ?? 50) - (a.priority ?? 50));
    else if (sortBy === "lapses") s.sort((a, b) => b.lapses - a.lapses);
    else s.sort((a, b) => (a.due ?? 0) - (b.due ?? 0));
    return s;
  }, [filteredMeta, sortBy]);

  // ---- v48.22（D58 §6.8-6）：按书分组 + 多选 + 批量（数据面＝meta 通道 + workflowAPI.listAll）
  const bookOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of metaAll) {
      if (c.bookId) m.set(String(c.bookId), String(c.docTitle || t("未知材料")));
    }
    for (const e of extracts) if (e.libraryItemId) m.set(String(e.libraryItemId), String(e.docTitle || t("未知材料")));
    return [{ value: "all", label: t("全部来源书") }, ...[...m.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }))];
  }, [metaAll, extracts]);

  // D158：方案条件作用于表格——来源书（下拉单选 ∪ 追加来源书）+ 标签 + 知识点归并族。
  // 这几项任何时候都作用于表格（创建面板追加条件即时生效，取消即恢复）；无方案条件时 schemeFilter=null，
  // 过滤与 v48.111 完全相同。
  const schemeBookIds = useMemo(
    () => [...new Set([...(bookScope !== "all" ? [bookScope] : []), ...deckExtraBooks])],
    [bookScope, deckExtraBooks]
  );
  const deckKpKey = deckKps.map((k) => k.id).sort().join("|");
  const [kpFamilyState, setKpFamilyState] = useState<{ key: string; ids: Set<string> } | null>(null);
  useEffect(() => {
    if (!deckKpKey) return;
    const ids = deckKpKey.split("|");
    let cancelled = false;
    window.knowledgeAPI
      ?.resolveFamilies(ids)
      .then((fam) => {
        if (!cancelled) setKpFamilyState({ key: deckKpKey, ids: new Set([...ids, ...fam]) });
      })
      .catch(() => {
        /* 解析失败：保持只按所选知识点本身匹配（只会更少，不会更多） */
      });
    return () => {
      cancelled = true;
    };
  }, [deckKpKey]);
  const schemeFilter = useMemo(
    () =>
      buildSchemeFilter({
        bookItemIds: schemeBookIds,
        tags: deckTags,
        kpIds: deckKpKey ? deckKpKey.split("|") : [],
        // 只采用与当前选择匹配的族；选择刚变化、新族尚未返回时回退为所选 id 本身
        kpFamily: kpFamilyState && kpFamilyState.key === deckKpKey ? kpFamilyState.ids : null
      }),
    [schemeBookIds, deckTags, deckKpKey, kpFamilyState]
  );
  const scopeMeta = useMemo(
    () => (schemeFilter ? sortedMeta.filter((m) => cardMatchesScheme(schemeFilter, m)) : sortedMeta),
    [sortedMeta, schemeFilter]
  );

  const scopeExtracts = useMemo(() => {
    const parsed = parseCardQuery(query);
    let list = extracts;
    // D158：方案条件（来源书并集 + 标签；知识点条件使摘录行恒不命中）取代原单书等值过滤
    if (schemeFilter) list = list.filter((e) => extractMatchesScheme(schemeFilter, e.libraryItemId, () => extractTagsOf(e as { tagJson?: string | null })));
    // v48.47（D87）：锚点筛选——摘录表只留闭包内条目（切「摘录」页签可看锚的来源树）
    if (anchorClosure) list = list.filter((e) => anchorClosure.has(String(e.id)));
    // v48.64（D108 §6.8-6 v3）：统一 AST 行判定——kind:card 使摘录行全不命中（原 L378 return []
    // 等价）、type: 恒不命中（摘录行无卡形式，诚实语义）、文本项逐词 AND（原整串子串）、
    // -book:/-status: 取反与 or/括号/通配符生效。D110：无条件时跳过逐行求值。
    if (parsed.ast) {
      list = list.filter((e) =>
        extractRowMatches(parsed, {
          contentMarkdown: e.contentMarkdown,
          docTitle: e.docTitle,
          status: e.status,
          tagJson: (e as { tagJson?: string | null }).tagJson,
          priority: e.priority
        })
      );
    }
    if (preset === "due") list = list.filter((e) => Number(e.topicNextAt) <= Date.now());
    // v48.40（D80）：摘录表此前完全忽略 sortBy（永远主进程的 priority/due 序），新摘录按到期升序沉底
    // ——补上与闪卡表同名的排序语义；「按创建时间」取降序（新摘录浮顶，可发现性）。
    const sorted = [...list];
    if (sortBy === "created") sorted.sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0));
    else if (sortBy === "priority") sorted.sort((a, b) => Number(b.priority) - Number(a.priority));
    else sorted.sort((a, b) => Number(a.topicNextAt ?? 0) - Number(b.topicNextAt ?? 0));
    return sorted;
  }, [extracts, schemeFilter, query, preset, sortBy, anchorClosure]);

  const cardsMeta = kindFilter === "extract" ? EMPTY_META : scopeMeta;
  const viewExtracts = kindFilter === "card" ? EMPTY_EXTRACTS : scopeExtracts;

  interface MouseMod {
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
  }
  function toggleSel(kind: "card" | "extract", id: string, e: MouseMod) {
    const set = kind === "card" ? selCards : selExtracts;
    const ids = (kind === "card" ? cardsMeta.map((m) => m.id) : scopeExtracts.map((x) => x.id));
    const next = new Set(set);
    if (e.shiftKey && anchorId && ids.includes(anchorId)) {
      const a = ids.indexOf(anchorId);
      const b = ids.indexOf(id);
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(ids[i]);
    } else if (e.ctrlKey || e.metaKey) {
      if (next.has(id)) next.delete(id);
      else next.add(id);
    } else {
      if (next.size === 1 && next.has(id)) next.clear();
      else {
        next.clear();
        next.add(id);
      }
    }
    setAnchorId(id);
    if (kind === "card") setSelCards(next);
    else setSelExtracts(next);
  }
  // v49.2（D176）：左侧复选框＝直接勾选/取消，逐个叠加不清空既有选择——
  // 修饰键语义（Ctrl/Shift）只属于行点击；复选框不需要也不消费快捷键
  function togglePick(kind: "card" | "extract", id: string) {
    const next = new Set(kind === "card" ? selCards : selExtracts);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setAnchorId(id);
    if (kind === "card") setSelCards(next);
    else setSelExtracts(next);
  }
  function selectAllOf(kind: "card" | "extract") {
    if (kind === "card") setSelCards(new Set(cardsMeta.map((m) => m.id)));
    else setSelExtracts(new Set(scopeExtracts.map((e) => e.id)));
  }
  function invertOf(kind: "card" | "extract") {
    if (kind === "card") setSelCards(new Set(cardsMeta.filter((m) => !selCards.has(m.id)).map((m) => m.id)));
    else setSelExtracts(new Set(scopeExtracts.filter((e) => !selExtracts.has(e.id)).map((e) => e.id)));
  }
  function flashNote(text: string) {
    setBatchNote(text);
    window.setTimeout(() => setBatchNote(null), 2400);
  }
  // v48.60（D101）：词表建议（浮层打开时拉取；派生只读，主进程现算）——v48.61（D105）扩条件构建器共用
  useEffect(() => {
    if (!tagPop && !deckBuilderOpen) return;
    let cancelled = false;
    window.cardsAPI?.listTags?.().then((l) => {
      if (!cancelled) setTagVocab(l ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [tagPop, deckBuilderOpen]);

  // v48.61（D105）：知识点多选候选——经 KnowledgeBase 检索口径（knowledge:listPoints），归并行如实标注
  useEffect(() => {
    if (!deckKpPop) return;
    let cancelled = false;
    window.knowledgeAPI
      ?.listPoints({ query: kpQuery || undefined, limit: 50 })
      .then((res) => {
        if (!cancelled) {
          setKpOptions(
            (res?.points ?? []).map((p) => ({ id: p.id, label: p.canonicalLabel, status: p.status, mergedInto: p.mergedInto }))
          );
        }
      })
      .catch(() => {
        if (!cancelled) setKpOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [deckKpPop, kpQuery]);
  /** v48.60（D101）：批量打标/去标——渲染层用 tags.ts 算每卡终值（规则单一源），主进程只存储 */
  async function runSetTags(mode: "add" | "remove", tags: string[]) {
    const ids = [...selCards];
    if (ids.length === 0 || tags.length === 0) return;
    setBatchBusy(true);
    try {
      // v48.67（D111）：选择集可能超出已取窗口——缺行的先经 cards:getWindow 分块补齐，
      // 标签终值仍基于当前真值计算（渲染层 tags.ts 规则单一源不变）；补的行不回写窗口缓存。
      const missing = ids.filter((id) => !rowCache.has(id));
      const local = new Map(rowCache);
      for (let i = 0; i < missing.length; i += 500) {
        const rows = await cardsApi.getWindow(missing.slice(i, i + 500));
        for (const r of rows) local.set(r.id, r);
      }
      const items = ids.map((id) => {
        const card = local.get(id);
        return {
          id,
          tags: applyTagDelta(card?.tags ?? [], mode === "add" ? tags : [], mode === "remove" ? tags : []).tags
        };
      });
      const r = await cardsApi.setTags(items);
      if (r?.ok) {
        setSelCards(new Set());
        setTagDraft([]);
        flashNote(T("已更新 {n} 张卡的标签", { n: r.count ?? ids.length }));
        eventBus.emit("cards/changed");
        await refresh();
      } else {
        flashNote(r?.reason || T("标签写入失败，整批未执行"));
      }
    } finally {
      setBatchBusy(false);
    }
  }
  async function runCardBatch(op: string, payload?: unknown) {
    const ids = [...selCards];
    if (ids.length === 0) return;
    if (op === "delete" && !window.confirm(T("删除选中的 {n} 张卡？（软删，可在备份中找回）", { n: ids.length }))) return;
    setBatchBusy(true);
    try {
      const r = await cardsApi.batch(op, ids, payload);
      if (r?.ok) {
        setSelCards(new Set());
        flashNote(T("已处理 {n} 张卡", { n: r.count ?? ids.length }));
        eventBus.emit("cards/changed");
        await refresh();
      } else {
        flashNote(r?.reason || T("批量操作失败，整批未执行"));
      }
    } finally {
      setBatchBusy(false);
    }
  }
  async function runExtractBatch(op: string, payload?: unknown) {
    const ids = [...selExtracts];
    if (ids.length === 0) return;
    if (op === "delete" && !window.confirm(T("删除选中的 {n} 条摘录？（软删，可在备份中找回）", { n: ids.length }))) return;
    setBatchBusy(true);
    try {
      const r = (await readingWorkflow.batch(op as never, ids, payload as never)) as { ok?: boolean; count?: number; skipped?: Array<{ reason: string }>; reason?: string };
      if (r?.ok) {
        setSelExtracts(new Set());
        const skipped = Array.isArray(r.skipped) && r.skipped.length ? T("（{n} 条按规则跳过）", { n: r.skipped.length }) : "";
        flashNote(T("已处理 {n} 条摘录", { n: r.count ?? ids.length }) + skipped);
        await refresh();
      } else {
        flashNote(r?.reason || T("批量操作失败，整批未执行"));
      }
    } finally {
      setBatchBusy(false);
    }
  }

  // D157：文案辅助（方案摘要 / 会话按钮文案）
  function kindsLabel(kinds: string[]): string {
    const c = kinds.includes("card");
    const e = kinds.includes("extract");
    if (c && e) return T("闪卡 + 摘录");
    return e ? T("摘录") : T("闪卡");
  }
  function kindsNoun(kinds: string[]): string {
    const c = kinds.includes("card");
    const e = kinds.includes("extract");
    if (c && e) return T("闪卡和摘录");
    return e ? T("摘录") : T("闪卡");
  }
  function bookLabel(id: string): string {
    return bookOptions.find((o) => o.value === id)?.label ?? T("已移除的书");
  }
  function startLabel(s: { kinds: string[] }): string {
    return s.kinds.includes("card") ? T("开始复习") : T("处理摘录");
  }
  function startTitle(s: { kinds: string[] }): string {
    return s.kinds.includes("card")
      ? T("只复习这个方案范围内的卡片，复习记录照常计入")
      : T("只处理这个方案范围内的摘录，处理记录照常计入");
  }
  function describeScope(s: SavedScope): string {
    const parts: string[] = [kindsLabel(s.kinds)];
    if (s.bookItemIds.length === 1) parts.push(bookLabel(s.bookItemIds[0]));
    if (s.bookItemIds.length > 1) parts.push(T("{book} 等 {n} 本书", { book: bookLabel(s.bookItemIds[0]), n: s.bookItemIds.length }));
    if (s.tags?.length) parts.push(T("标签：{tags}{more}", { tags: s.tags.slice(0, 2).join("、"), more: s.tags.length > 2 ? T(" 等 {n} 个", { n: s.tags.length }) : "" }));
    if (s.kpIds?.length) parts.push(T("知识点 {n} 个（仅闪卡）", { n: s.kpIds.length }));
    if (parts.length === 1) parts.push(T("不限来源"));
    return parts.join(" · ");
  }

  // v48.22（D58 §6.8-5）：保存当前筛选为方案 / 套用 / 开始复习 / 删除
  // v48.61（D105）：条件构建器（书多选/标签多选/知识点多选）+「用当前查询创建」提取 book:/tag: 转结构化
  // D157：构造逻辑抽为 buildScopeDraft（创建面板「将保存的条件」预览与保存共用同一函数，所见即所存）
  function buildScopeDraft(): Omit<SavedScope, "id" | "name"> {
    const cond = extractScopeConditions(query);
    const bookItemIds = [
      ...new Set([
        ...(bookScope !== "all" ? [bookScope] : []),
        ...deckExtraBooks,
        // 查询里的 book: 书名子串 → 按书名（NFKC 折叠）解析为 libraryItemId；无命中如实丢弃
        ...cond.bookNames.flatMap((needle) =>
          bookOptions.filter((o) => o.value !== "all" && foldSearch(o.label).includes(foldSearch(needle))).map((o) => o.value)
        )
      ])
    ];
    const tags = [...new Set([...deckTags, ...cond.tags])];
    return {
      bookItemIds,
      tags,
      kpIds: deckKps.map((k) => k.id),
      kinds: kindFilter === "both" ? ["card", "extract"] : [kindFilter],
      limits: deckCapExtracts > 0 || deckCapNewCards > 0
        ? { ...(deckCapExtracts > 0 ? { extractReviewsPerDay: deckCapExtracts } : {}), ...(deckCapNewCards > 0 ? { newCardsPerDay: deckCapNewCards } : {}) }
        : null
    };
  }
  async function saveDeck() {
    const draft = buildScopeDraft();
    const fallback = kindFilter === "card" ? T("闪卡") : kindFilter === "extract" ? T("摘录") : T("全部");
    const name = deckName.trim() || T("筛选方案 · {kind}", { kind: fallback });
    const scope: SavedScope = { id: crypto.randomUUID(), name, ...draft };
    const next = [...scopes, scope];
    await settingsStore.set("app", "reviewScopes", next);
    setScopes(next);
    setDeckName("");
    setDeckCapExtracts(0);
    setDeckCapNewCards(0);
    setDeckBookPop(false);
    setDeckKpPop(false);
    setDeckBuilderOpen(false);
    editorSnapshotRef.current = null;
    setSchemeEditorOpen(false);
    applyDeck(scope, { silent: true }); // 保存即套用：让表格精确等于方案（先关弹层）
    setSchemeMenuOpen(true);            // 再自动打开列表，让用户看到新方案
    flashNote(T("已保存并套用方案「{name}」", { name }));
  }
  function applyDeck(s: SavedScope, opts?: { silent?: boolean }) {
    setKindFilter(s.kinds.length === 2 ? "both" : s.kinds[0] === "extract" ? "extract" : "card");
    setBookScope(s.bookItemIds[0] || "all");
    setDeckExtraBooks(s.bookItemIds.slice(1));
    setDeckTags(s.tags ?? []);
    // 知识点 chip 需要 label——先以 id 占位（filterSig 只取 id，占位→label 补齐不会误标「已改动」），
    // 再经 KnowledgeBase 列表异步回填（找不到的 id 原样显示，不猜）
    const ids = [...new Set(s.kpIds ?? [])];
    setDeckKps(ids.map((id) => ({ id, label: id })));
    if (ids.length) {
      window.knowledgeAPI
        ?.listPoints({ limit: 1000 })
        .then((res) => {
          const byId = new Map((res?.points ?? []).map((p) => [p.id, p.canonicalLabel]));
          setDeckKps(ids.map((id) => ({ id, label: byId.get(id) ?? id })));
        })
        .catch(() => setDeckKps(ids.map((id) => ({ id, label: id }))));
    }
    // D157：方案即完整条件——套用时清空搜索框（即时值 + 防抖值都清，否则 300ms 后回填旧词）
    setQuery("");
    setQueryInput("");
    setActiveSchemeId(s.id);
    setActiveSchemeSig("");
    setSigCaptureToken((t) => t + 1);
    setSchemeMenuOpen(false);
    if (!opts?.silent) flashNote(T("已套用方案「{name}」", { name: s.name }));
  }
  function exitScheme(opts?: { silent?: boolean }) {
    setKindFilter("card");
    setBookScope("all");
    setDeckExtraBooks([]);
    setDeckTags([]);
    setDeckKps([]);
    setActiveSchemeId(null);
    setActiveSchemeSig("");
    if (!opts?.silent) flashNote(T("已退出方案"));
  }
  async function deleteDeck(id: string) {
    const target = scopes.find((s) => s.id === id);
    const next = scopes.filter((s) => s.id !== id);
    await settingsStore.set("app", "reviewScopes", next);
    setScopes(next);
    if (id === activeSchemeId) exitScheme({ silent: true }); // 删除当前方案 = 同时退出方案
    if (target) flashNote(T("已删除方案「{name}」", { name: target.name }));
  }
  function openSchemeEditor() {
    editorSnapshotRef.current = { books: deckExtraBooks, tags: deckTags, kps: deckKps };
    setDeckName("");
    setDeckCapExtracts(0);
    setDeckCapNewCards(0);
    setDeckBuilderOpen(deckExtraBooks.length > 0 || deckTags.length > 0 || deckKps.length > 0);
    setSchemeMenuOpen(false);
    setSchemeEditorOpen(true);
  }
  function cancelSchemeEditor() {
    const snap = editorSnapshotRef.current;
    if (snap) {
      setDeckExtraBooks(snap.books);
      setDeckTags(snap.tags);
      setDeckKps(snap.kps);
    }
    editorSnapshotRef.current = null;
    setDeckBookPop(false);
    setDeckKpPop(false);
    setDeckBuilderOpen(false);
    setSchemeEditorOpen(false);
  }
  function startScheme(s: SavedScope) {
    if (!onStartSession) return;
    setSchemeMenuOpen(false);
    onStartSession({
      bookItemIds: s.bookItemIds,
      tags: s.tags,
      kpIds: s.kpIds,
      kinds: s.kinds,
      name: s.name,
      limits: (s.limits as Record<string, number> | null) ?? null
    });
  }

  /** 查找替换（O-8：仅选中项、仅正文、纯文本；逐条落 edit 操作日志，撤销按次回退） */
  async function runFindReplace() {
    const needle = findText;
    if (!needle) {
      flashNote(T("请先填写要查找的文字"));
      return;
    }
    const ids = [...selExtracts];
    if (ids.length === 0) return;
    setBatchBusy(true);
    try {
      let changed = 0;
      for (const id of ids) {
        const cur = extracts.find((e) => e.id === id);
        const text = String(cur?.contentMarkdown ?? "");
        if (!text.includes(needle)) continue;
        await readingWorkflow.updateContent(id, text.split(needle).join(replaceText));
        changed += 1;
      }
      flashNote(changed > 0 ? T("已替换 {n} 条摘录的正文", { n: changed }) : T("选中的摘录里没有该文字"));
      await refresh();
    } finally {
      setBatchBusy(false);
    }
  }

  // v48.22（D58 §6.8-6）：行数窗口（先渲染 200 行 + 「显示更多」）已在 v48.66/D110 退役。
  // D110：真虚拟滚动——固定行高窗口化渲染（30 万卡量测驱动，基线/复测数字见 tests/browser.perf.log）。
  // 滚动容器＝组件根 .queue-wrap；两表各自按「表顶相对滚动视口」计算可见行区间（±OVERSCAN 冗余），
  // 前后 spacer 撑起总高使滚动条稳定。行高恒定的依据：.cb-row 为 grid 单行 + 题面/来源列 nowrap
  // + 行详情＝模态（非行内展开）。「显示更多」增量放行随之退役（滚动到底即全部可达）。
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const cardTableRef = useRef<HTMLDivElement | null>(null);
  const extractTableRef = useRef<HTMLDivElement | null>(null);
  const [rowH, setRowH] = useState(40);
  const [headH, setHeadH] = useState(37);
  const [win, setWin] = useState({ card: { start: 0, end: 0 }, extract: { start: 0, end: 0 } });

  const recomputeWindows = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const viewportH = wrap.clientHeight;
    if (viewportH <= 0) return;
    const wrapTop = wrap.getBoundingClientRect().top;
    const OVERSCAN = 12;
    // D110：Chromium 单滚动容器 scrollHeight 硬上限 ≈ 13.42M px（实测 30 万行 × 66px = 19.8M 被
    // 钳在 13,421,773，滚到底物理不可达最后 ~9.7 万行；5 万行 3.3M 未触限）。总高超限时按比例
    // 压缩 spacer 虚拟高度（C<1），滚动位置除以 C 还原行 index——滚动条一格覆盖多行、全程可达；
    // C=1（total×rowH ≤ 上限）时映射完全精确。
    const calc = (table: HTMLElement | null, total: number) => {
      if (!table || total === 0 || rowH <= 0) return { start: 0, end: 0 };
      const c = Math.min(1, SCROLL_CAP / (total * rowH));
      const rel = table.getBoundingClientRect().top - wrapTop + headH; // 行区顶相对滚动视口（真实 px）
      const unit = rowH * c;
      const start = Math.max(0, Math.floor(-rel / unit) - OVERSCAN);
      const end = Math.min(total, Math.max(start, Math.ceil((viewportH - rel) / unit) + OVERSCAN));
      return { start, end };
    };
    const nextCard = calc(cardTableRef.current, cardsMeta.length);
    const nextExtract = calc(extractTableRef.current, viewExtracts.length);
    setWin((prev) =>
      prev.card.start === nextCard.start && prev.card.end === nextCard.end && prev.extract.start === nextExtract.start && prev.extract.end === nextExtract.end
        ? prev
        : { card: nextCard, extract: nextExtract }
    );
  }, [rowH, headH, cardsMeta, viewExtracts]);

  // 行高实测——必须等窗口渲染出真实行后再量（首帧 win 全 0 量不到，估计值 40 与真实行高的偏差
  // 在 30 万行深度会被 spacer 放大成「滚到底换页失准」；实测踩坑）。表样式为全局常量 → 量准一次即定。
  useLayoutEffect(() => {
    const table = cardTableRef.current ?? extractTableRef.current;
    if (!table) return;
    const row = table.querySelector(".cb-row:not(.cb-row-head)") as HTMLElement | null;
    const head = table.querySelector(".cb-row-head") as HTMLElement | null;
    if (row) {
      const h = Math.max(1, Math.round(row.getBoundingClientRect().height));
      if (h !== rowH) setRowH(h);
    }
    if (head) {
      const h = Math.max(1, Math.round(head.getBoundingClientRect().height));
      if (h !== headH) setHeadH(h);
    }
  }, [win, loaded, preset, kindFilter, rowH, headH]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onScroll = () => recomputeWindows();
    wrap.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      wrap.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [recomputeWindows]);

  // v48.67（D111）：win 进依赖＝有界不动点迭代——spacer 换位与滚动锚定补偿后，按更新后的布局
  // 再算一次；setWin 等值短路保证收敛（同值 bail 终止，不会回到每渲染重算的循环）。
  useEffect(() => {
    recomputeWindows();
  }, [recomputeWindows, win]);

  // 查询语法里的 `kind:` 直接切类别页签（否则「搜了 kind:extract 却什么都不显示」）；
  // v48.64（D108）：含 or/括号的查询不做页签联动（kind 只是行谓词，布尔语义照常求值）
  useEffect(() => {
    const parsed = parseCardQuery(query);
    if (!parsed.hasGroups && parsed.kind) setKindFilter(parsed.kind);
  }, [query]);

  // ---- v48.67（D111）：行窗口取数 + 详情/同源组/血缘计数 ----

  // 窗口内可见 id → 缺的全行经 cards:getWindow 按需补（渲染层缓存随库指纹整体清空、超限按插入序淘汰）
  const visibleCardIds = useMemo(
    () => cardsMeta.slice(win.card.start, win.card.end).map((m) => m.id),
    [cardsMeta, win]
  );
  // rowCacheRef：让取数回调读最新缓存而不必把整张缓存挂进依赖（避免取数-写缓存-重跑循环）
  const rowCacheRef = useRef(rowCache);
  useEffect(() => {
    rowCacheRef.current = rowCache;
  }, [rowCache]);
  const fetchRowsIntoCache = useCallback(async (ids: string[]) => {
    const missing = ids.filter((id) => !rowCacheRef.current.has(id));
    if (missing.length === 0) return;
    for (let i = 0; i < missing.length; i += 500) {
      const rows = (await cardsApi.getWindow(missing.slice(i, i + 500))) as BrowserCard[];
      setRowCache((prev) => {
        const next = new Map(prev);
        for (const r of rows) next.set(r.id, r);
        return pruneRowCache(next);
      });
    }
  }, []);
  useEffect(() => {
    if (visibleCardIds.length === 0) return;
    let cancelled = false;
    (async () => {
      const missing = visibleCardIds.filter((id) => !rowCacheRef.current.has(id));
      if (missing.length === 0 || cancelled) return;
      await fetchRowsIntoCache(visibleCardIds);
    })();
    return () => {
      cancelled = true;
    };
  }, [visibleCardIds, fetchRowsIntoCache]);

  // 行详情：行缓存命中即用，未命中按需取单行（原全量 all.find 退役）
  const detail = detailId ? rowCache.get(detailId) ?? null : null;
  useEffect(() => {
    if (!detailId || rowCache.has(detailId)) return;
    let cancelled = false;
    cardsApi.getWindow([detailId]).then((rows) => {
      const row = rows[0] as BrowserCard | undefined;
      if (!cancelled && row) {
        setRowCache((prev) => {
          const next = new Map(prev);
          next.set(row.id, row);
          return pruneRowCache(next);
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [detailId, rowCache]);

  // 卡详情同源组行（cards:siblingGroup 按需取；sibling_key 为空不取）
  const [siblingRows, setSiblingRows] = useState<BrowserCard[]>([]);
  useEffect(() => {
    const key = detail?.siblingKey;
    if (!key) {
      setSiblingRows([]);
      return;
    }
    let cancelled = false;
    cardsApi.siblingGroup(key).then((rows) => {
      if (!cancelled) setSiblingRows(rows as BrowserCard[]);
    });
    return () => {
      cancelled = true;
    };
  }, [detail?.siblingKey]);

  // 卡详情血缘树制卡计数：从轻量行集派生（buildLineageTree 只消费 contextRef.extractId 计数）
  const lineageCards = useMemo(
    () => metaAll.map((m) => ({ contextRef: m.extractId ? { extractId: m.extractId } : null })),
    [metaAll]
  );

  // 难点页签旧列表视图（未虚拟化）：只列前 LEECH_LIST_CAP 条的窗口行 + 计数提示
  const leechListIds = useMemo(
    () => (preset === "leech" ? cardsMeta.slice(0, LEECH_LIST_CAP).map((m) => m.id) : []),
    [preset, cardsMeta]
  );
  useEffect(() => {
    if (leechListIds.length === 0) return;
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await fetchRowsIntoCache(leechListIds);
    })();
    return () => {
      cancelled = true;
    };
  }, [leechListIds, fetchRowsIntoCache]);

  const extractDetail = extractDetailId ? extracts.find((e) => e.id === extractDetailId) ?? null : null;

  return (
    <div className="queue-wrap" ref={wrapRef}>
      {/* v48.40（D80）：吸顶头带——preset 页签（与摘录/复习页头带同语言：band-line 下缘 hairline）。
          v48.111（D156）：纯文字统计行退役，计数归一进页签（.tab-cnt，无括号） */}
      <div className="cb-head">
        <div className="cb-head-inner">
          <div className="seg-tabs" role="tablist" aria-label={T("卡片预设范围")}>
            <button className={preset === "all" ? "active" : ""} onClick={() => setPreset("all")}>
              {T("全部卡片")}<span className="tab-cnt">{metaAll.length}</span>
            </button>
            <button className={preset === "due" ? "active" : ""} onClick={() => setPreset("due")}>
              {T("到期卡片")}<span className="tab-cnt">{counts.due}</span>
            </button>
            <button className={preset === "leech" ? "active" : ""} onClick={() => setPreset("leech")}>
              {T("记忆难点")}<span className="tab-cnt">{counts.leech}</span>
            </button>
            {/* v34（M12，§4.16）：今日同源暂缓——被同源卡延后到明日的卡（点开行详情可见原因） */}
            {counts.deferred > 0 && (
              <button className={preset === "deferred" ? "active" : ""} onClick={() => setPreset("deferred")}>
                {T("今日暂缓")}<span className="tab-cnt">{counts.deferred}</span>
              </button>
            )}
            {/* v40（K1，D37）：知识地基管理面（§9.1 K1-4 最小管理页） */}
            <button className={preset === "knowledge" ? "active" : ""} onClick={() => setPreset("knowledge")}>
              {T("知识点")}{kpTotal != null && <span className="tab-cnt">{kpTotal}</span>}
            </button>
            {/* v48.60（D102）：已归档（不再关心）——默认列表不含归档，这里显式进入 */}
            <button className={preset === "archived" ? "active" : ""} onClick={() => setPreset("archived")}>
              {T("已归档")}<span className="tab-cnt">{counts.archived}</span>
            </button>
          </div>
        </div>
      </div>

      {preset === "knowledge" && <KnowledgeManager />}

      {preset !== "knowledge" && (
      <>
      {/* v48.40（D80）：工具行——better-layout「一盒一功能」：搜索 grow / 筛选 / 类别 / 来源书 各成一盒（border-strong 描边，16px 组距） */}
      <div className="cb-toolbar">
        <div className="cb-cluster cb-cluster-grow">
          <input
            className="cb-search"
            placeholder={T('搜索题面、答案、前缀、来源、领域、标签…（支持 -排除、kind:、book:、status:、priority<=30）')}
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
          />
        </div>
        <div className="cb-cluster">
          <Dropdown title={T("按卡片类型筛选")} value={typeFilter} options={typeOptions} onChange={setTypeFilter} />
          <Dropdown
            title={T("按复习状态筛选")}
            value={stateFilter}
            options={[
              { value: "all", label: T("全部状态") },
              { value: "new", label: T("新卡") },
              { value: "learning", label: T("学习中") },
              { value: "review", label: T("复习中") },
              { value: "suspended", label: T("已暂停") },
              { value: "archived", label: T("已归档") }
            ]}
            onChange={setStateFilter}
          />
          <Dropdown
            title={T("排序方式")}
            value={sortBy}
            options={[
              { value: "due", label: T("按到期时间") },
              { value: "created", label: T("按创建时间") },
              { value: "priority", label: T("按优先级") },
              { value: "lapses", label: T("按遗忘次数") }
            ]}
            onChange={setSortBy}
          />
          {/* v46（M14-UM2，§6.7.3）：记忆接地筛选——情境来自记忆的卡（含「来源存疑」）。
              v49.5（D179）：随用户记忆功能暂时移除（D159 同批口径，v48.114 摘除时遗漏的本面）——
              按钮自产品面摘除，memFilter 状态与过滤链（`if (memFilter)` 行）原样保留；
              重实装时按 §6.7.3 回插本钮。
          <button
            className={`btn btn-sm ${memFilter ? "btn-primary" : "btn-outline"}`}
            title="只显示情境来自用户记忆的卡片"
            onClick={() => setMemFilter((v) => !v)}
          >
            记忆接地
          </button>
          */}
        </div>
        {/* v48.22（D58 §6.8-6）：类别切换（闪卡 / 摘录 / 全部） + 按来源书筛选 */}
        <div className="cb-cluster">
          <div className="seg-tabs seg-tabs-sm" role="group" aria-label={T("条目类别")}>
            <button className={kindFilter === "card" ? "active" : ""} data-kind-card onClick={() => setKindFilter("card")}>
              {T("闪卡")}
            </button>
            <button className={kindFilter === "extract" ? "active" : ""} data-kind-extract onClick={() => setKindFilter("extract")}>
              {T("摘录")}
            </button>
            <button className={kindFilter === "both" ? "active" : ""} data-kind-both onClick={() => setKindFilter("both")}>
              {T("全部")}
            </button>
          </div>
          <Dropdown title={T("按来源书筛选")} value={bookScope} options={bookOptions} onChange={setBookScope} />
        </div>
        {/* D157：筛选方案入口（原「筛选牌组」常驻行） */}
        <span className="cb-scheme" data-deck-bar ref={schemeWrapRef}>
          <button
            type="button"
            className={`btn btn-sm cb-scheme-btn${activeScheme && !activeModified ? " is-active" : " btn-outline"}`}
            data-scheme-toggle
            aria-haspopup="dialog"
            aria-expanded={schemeMenuOpen}
            title={
              !activeScheme
                ? T("筛选方案：把常用的筛选条件存下来，之后一键套用，或只复习这个范围")
                : activeModified
                  ? T("方案「{name}」（已改动）：{scope}。当前筛选已偏离这个方案，重新套用可恢复。", { name: activeScheme.name, scope: describeScope(activeScheme) })
                  : T("方案「{name}」：{scope}。表格已按此方案筛选；页签、类型、状态和搜索框仍可在其上继续筛选。", { name: activeScheme.name, scope: describeScope(activeScheme) })
            }
            onClick={() => setSchemeMenuOpen((v) => !v)}
          >
            {activeScheme ? (
              <>
                <span className="cb-scheme-btn-label">{T("方案：")}{activeScheme.name}</span>
                {activeModified && <span className="n"> · {T("已改动")}</span>}
              </>
            ) : (
              <>
                {T("筛选方案")}
                {scopes.length > 0 && <span className="n"> {scopes.length}</span>}
              </>
            )}
            <IconChevronDown size={12} className="dd-caret" />
          </button>
          {activeScheme && !activeModified && onStartSession && (
            <button type="button" className="btn btn-outline btn-sm" data-scheme-start-active
              title={startTitle(activeScheme)} onClick={() => startScheme(activeScheme)}>
              {startLabel(activeScheme)}
            </button>
          )}
          {activeScheme && (
            <button type="button" className="btn btn-outline btn-sm" data-scheme-exit
              title={T("退出方案：清除这个方案带来的筛选条件")} onClick={() => exitScheme()}>
              {T("退出方案")}
            </button>
          )}
          {schemeMenuOpen && (
            <div className="cb-scheme-pop" role="dialog" aria-label={T("筛选方案")} data-scheme-menu>
              <div className="cb-scheme-head">
                <span className="cb-scheme-title">{T("筛选方案")}</span>
                <span className="form-hint">{T("把常用的筛选条件存成方案，之后可一键套用，或只复习这个范围。不会移动或复制卡片。")}</span>
              </div>
              {scopes.length === 0 ? (
                <div className="cb-scheme-empty" data-scheme-empty>
                  <span className="cb-scheme-empty-title">{T("还没有筛选方案")}</span>
                  <span className="form-hint">{T("先用搜索框和上方筛选找到想要的卡片，再点下面的按钮，把这组条件存成方案。")}</span>
                </div>
              ) : (
                <ul className="cb-scheme-list">
                  {scopes.map((s) => (
                    <li key={s.id} className={`cb-scheme-row${s.id === activeSchemeId ? " is-active" : ""}`} data-deck-item>
                      <div className="cb-scheme-info">
                        <span className="cb-scheme-name" title={s.name}>
                          {s.name}
                          {s.id === activeSchemeId && (
                            <span className="cb-scheme-flag">{activeModified ? T("当前 · 已改动") : T("当前")}</span>
                          )}
                        </span>
                        <span className="cb-scheme-sum">{describeScope(s)}</span>
                      </div>
                      <div className="cb-scheme-actions">
                        <button type="button" className="btn btn-outline btn-sm" data-deck-apply
                          title={T("套用：把卡片表切换到这个方案的条件")} onClick={() => applyDeck(s)}>
                          {T("套用")}
                        </button>
                        {onStartSession && (
                          <button type="button" className="btn btn-outline btn-sm" data-deck-start
                            title={startTitle(s)} onClick={() => startScheme(s)}>
                            {startLabel(s)}
                          </button>
                        )}
                        <button type="button" className="btn btn-outline btn-sm cb-scheme-del" data-deck-delete
                          title={T("删除这个方案（卡片不受影响）")} onClick={() => void deleteDeck(s.id)}>
                          {T("删除")}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <div className="cb-scheme-foot">
                <button type="button" className={`btn btn-sm ${scopes.length === 0 ? "btn-primary" : "btn-outline"}`}
                  data-scheme-new onClick={openSchemeEditor}>
                  {T("＋ 将当前筛选存为方案")}
                </button>
              </div>
            </div>
          )}
        </span>
      </div>

      {/* v48.47（D87）：锚点筛选条——来自阅读/摘录浮窗「已制卡 N 张」或卡详情血缘树「查看卡片」；计数＝闭包内卡数 */}
      {anchorFilter && (
        <div className="cb-anchor-bar" data-anchor-filter-bar>
          <span className="mono">{T("锚点筛选")}</span>
          <span data-anchor-filter-count>{T("已制卡 {n} 张（含全部子层级）", { n: metaAll.filter((m) => anchorClosure?.has(String(m.extractId || ""))).length })}</span>
          <button className="crumb-exit" data-anchor-filter-clear onClick={clearAnchorFilter} title={T("清除锚点筛选，回到全部条目")}>
            {T("清除")}
          </button>
        </div>
      )}
      {/* v48.40（D80）：批量动作条移至吸底 stage-bar（见页尾）——未选中时此处不再常驻空条 */}
      {/* D157：新建筛选方案面板（按需出现；替代原「筛选牌组」常驻行 + 条件构建器行） */}
      {schemeEditorOpen && (() => {
        const draft = buildScopeDraft();
        const noScope = draft.bookItemIds.length === 0 && !draft.tags?.length && !draft.kpIds?.length;
        return (
          <section className="cb-scheme-editor" data-scheme-editor aria-label={T("新建筛选方案")}
            onKeyDown={(e) => { if (isImeComposing(e)) return; if (e.key === "Escape") cancelSchemeEditor(); }}>
            <div className="cb-scheme-editor-title">{T("新建筛选方案")}</div>

            <div className="cb-scheme-field">
              <span className="cb-scheme-label">{T("方案名称")}</span>
              <div className="cb-scheme-value">
                <input
                  className="cb-search cb-scheme-name-input"
                  data-deck-name
                  autoFocus
                  placeholder={T("例如：考研英语（留空则自动命名）")}
                  value={deckName}
                  onChange={(e) => setDeckName(e.target.value)}
                  onKeyDown={(e) => { if (isImeComposing(e)) return; if (e.key === "Enter") void saveDeck(); }}
                />
              </div>
            </div>

            <div className="cb-scheme-field">
              <span className="cb-scheme-label">{T("将保存的条件")}</span>
              <div className="cb-scheme-value" data-scheme-preview>
                <div className="cb-scheme-cond">
                  <span className="cb-scheme-cond-key">{T("内容")}</span>
                  <span>{kindsLabel(draft.kinds)}</span>
                  <span className="form-hint">{T("（在上方工具行切换）")}</span>
                </div>
                {draft.bookItemIds.length > 0 && (
                  <div className="cb-scheme-cond">
                    <span className="cb-scheme-cond-key">{T("来源书")}</span>
                    {draft.bookItemIds.map((id) => <span key={id} className="tag-chip tag-chip-static">{bookLabel(id)}</span>)}
                  </div>
                )}
                {!!draft.tags?.length && (
                  <div className="cb-scheme-cond">
                    <span className="cb-scheme-cond-key">{T("标签")}</span>
                    {draft.tags.map((t) => <span key={t} className="tag-chip tag-chip-static">{t}</span>)}
                  </div>
                )}
                {deckKps.length > 0 && (
                  <div className="cb-scheme-cond">
                    <span className="cb-scheme-cond-key">{T("知识点")}</span>
                    {deckKps.map((k) => <span key={k.id} className="tag-chip tag-chip-static">{k.label}</span>)}
                    <span className="form-hint">{T("（仅闪卡）")}</span>
                  </div>
                )}
                {noScope && (
                  <span className="form-hint">{T("未限定来源书、标签或知识点：这个方案将包含所有{kind}。", { kind: kindsNoun(draft.kinds) })}</span>
                )}
                {/* v49.5（D179）：「记忆接地」随用户记忆功能暂时移除，文案同步摘除（重实装时回插该列举） */}
                <span className="form-hint">{T("页签、类型、状态、排序不属于方案，不会保存。")}</span>
                {query.trim() !== "" && (
                  <span className="form-hint">{T("搜索框里只有 book: 和 tag: 条件会被保存，其余内容不会保存。")}</span>
                )}
              </div>
            </div>

            <div className="cb-scheme-field">
              <span className="cb-scheme-label">{T("追加条件")}</span>
              <div className="cb-scheme-value">
                <div>
                  <button type="button" className="btn btn-outline btn-sm" data-deck-builder-toggle
                    aria-expanded={deckBuilderOpen} onClick={() => setDeckBuilderOpen((v) => !v)}>
                    {T("追加条件（可选）")}
                    <IconChevronDown size={12} className={`dd-caret cb-scheme-disclosure${deckBuilderOpen ? " is-open" : ""}`} />
                  </button>
                </div>
                <span className="form-hint" data-scheme-live-hint>{T("追加的条件会立即作用于下方表格；点「取消」可撤销。")}</span>
                {deckBuilderOpen && (
                  <div className="cb-scheme-builder" data-deck-builder>
                    <span className="cb-deck-chips">
                      {deckExtraBooks.map((id) => (
                        <span key={id} className="tag-chip tag-chip-static" data-deck-book-chip>
                          {bookOptions.find((o) => o.value === id)?.label ?? id}
                          <button
                            className="cb-deck-chip-x"
                            aria-label={T("移除该书条件")}
                            onClick={() => setDeckExtraBooks((b) => b.filter((x) => x !== id))}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                      <button className="btn btn-outline btn-sm" data-deck-add-book onClick={() => setDeckBookPop((v) => !v)}>
                        {T("＋ 来源书")}
                      </button>
                    </span>
                    {deckBookPop && (
                      <span className="cb-deck-pop" data-deck-book-pop>
                        {bookOptions.filter((o) => o.value !== "all").map((o) => (
                          <label key={o.value} className="cb-deck-pop-row">
                            <input
                              type="checkbox"
                              checked={deckExtraBooks.includes(o.value)}
                              onChange={(e) =>
                                setDeckExtraBooks((b) => (e.target.checked ? [...b, o.value] : b.filter((x) => x !== o.value)))
                              }
                            />
                            {o.label}
                          </label>
                        ))}
                        {bookOptions.filter((o) => o.value !== "all").length === 0 && <span className="form-hint">{T("暂无可选书")}</span>}
                      </span>
                    )}
                    {tagsEnabled && (
                      <span className="cb-deck-tags" data-deck-tags>
                        <TagInput value={deckTags} onChange={setDeckTags} suggestions={tagVocab} ariaLabel={T("方案标签条件")} placeholder={T("标签（回车确认，支持层级前缀）")} />
                      </span>
                    )}
                    <span className="cb-deck-chips">
                      {deckKps.map((k) => (
                        <span key={k.id} className="tag-chip tag-chip-static" data-deck-kp-chip>
                          {k.label}
                          <button
                            className="cb-deck-chip-x"
                            aria-label={T("移除该知识点条件")}
                            onClick={() => setDeckKps((ks) => ks.filter((x) => x.id !== k.id))}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                      <button className="btn btn-outline btn-sm" data-deck-add-kp onClick={() => setDeckKpPop((v) => !v)}>
                        {T("＋ 知识点")}
                      </button>
                    </span>
                    {deckKpPop && (
                      <span className="cb-deck-pop cb-deck-pop-col" data-deck-kp-pop>
                        <input
                          className="cb-search"
                          data-deck-kp-search
                          placeholder={T("搜索知识点（名称/别名）…")}
                          value={kpQuery}
                          onChange={(e) => setKpQuery(e.target.value)}
                        />
                        <span className="cb-deck-pop-list">
                          {kpOptions.map((p) => (
                            <label key={p.id} className="cb-deck-pop-row">
                              <input
                                type="checkbox"
                                checked={deckKps.some((k) => k.id === p.id)}
                                onChange={(e) =>
                                  setDeckKps((ks) =>
                                    e.target.checked ? [...ks, { id: p.id, label: p.label }] : ks.filter((x) => x.id !== p.id)
                                  )
                                }
                              />
                              {p.label}
                              {p.status === "merged" && <span className="form-hint">{T("（已归并，匹配时自动展开）")}</span>}
                            </label>
                          ))}
                          {kpOptions.length === 0 && <span className="form-hint">{T("无匹配知识点")}</span>}
                        </span>
                      </span>
                    )}
                    {deckKps.length > 0 && <span className="form-hint" data-deck-kp-hint>{T("知识点条件只对闪卡生效，摘录不会被选中")}</span>}
                  </div>
                )}
              </div>
            </div>

            <div className="cb-scheme-field">
              <span className="cb-scheme-label">{T("每日上限")}</span>
              <div className="cb-scheme-value">
                <div className="cb-scheme-caps">
                  <label className="cb-scheme-cap">
                    {T("新卡最多")}
                    <input className="mono input-num" data-deck-cap-newcards type="number" min={0} max={9999}
                      placeholder={T("沿用全局")}
                      value={deckCapNewCards === 0 ? "" : deckCapNewCards}
                      onChange={(e) => setDeckCapNewCards(Math.max(0, Math.min(9999, Number(e.target.value) || 0)))} />
                    {T("张/天")}
                  </label>
                  <label className="cb-scheme-cap">
                    {T("摘录最多")}
                    <input className="mono input-num" data-deck-cap-extracts type="number" min={0} max={9999}
                      placeholder={T("沿用全局")}
                      value={deckCapExtracts === 0 ? "" : deckCapExtracts}
                      onChange={(e) => setDeckCapExtracts(Math.max(0, Math.min(9999, Number(e.target.value) || 0)))} />
                    {T("条/天")}
                  </label>
                </div>
                <span className="form-hint">{T("不作用于表格显示；仅在点「开始复习 / 处理摘录」时限制该范围当天的新卡与摘录处理量（与全局取较小值）。留空 = 沿用全局。")}</span>
              </div>
            </div>

            <div className="cb-scheme-editor-actions">
              <button type="button" className="btn btn-outline btn-sm" data-scheme-cancel onClick={cancelSchemeEditor}>{T("取消")}</button>
              <button type="button" className="btn btn-primary btn-sm" data-deck-save onClick={() => void saveDeck()}>{T("保存方案")}</button>
            </div>
          </section>
        );
      })()}

      {/* v48.111（D156）：摘录页签下不渲染恒空的闪卡表（cardsMeta 强制空集，表头纯噪声） */}
      {preset === "leech" ? (
        <div className="queue-list">
          {/* v48.67（D111）：该视图未虚拟化（queue-row 变高不可窗口化）——只列前 LEECH_LIST_CAP 条 + 计数提示 */}
          {cardsMeta.length > leechListIds.length && (
            <div className="form-hint">{T("共 {total} 条，仅列出前 {cap} 条（其余请用查询缩小范围）", { total: cardsMeta.length, cap: LEECH_LIST_CAP })}</div>
          )}
          {leechListIds.map((id) => rowCache.get(id)).filter((c): c is BrowserCard => Boolean(c)).map((c) => (
            <div key={c.id} className="queue-row" onClick={() => setDetailId(c.id)}>
              <div className="queue-row-head">
                <span>
                  {c.leech?.suspended ? T("已暂停") : T("处理中")} · {T("遗忘 {n} 次", { n: c.fsrs?.lapses ?? 0 })}
                  {c.docTitle ? T(" · 来自 {src}", { src: srcLabel(c) }) : ""}
                </span>
                <span className="mono">P{c.priority}</span>
              </div>
              <div className="queue-row-text">{c.frontMarkdown || c.noteText}</div>
              <div className="queue-actions">
                <button
                  className="btn btn-primary btn-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setLeechTarget(c);
                  }}
                >
                  {T("六步处理")}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : kindFilter !== "extract" && (
        <div className="cb-table" role="table" ref={cardTableRef}>
          <div className="cb-row cb-row-head" role="row">
            <span className="cb-pick">{T("选")}</span>
            <span>{T("题面")}</span>
            <span>{T("类型")}</span>
            <span>{T("状态")}</span>
            <span>{T("到期")}</span>
            <span className="cb-num">{T("复习")}</span>
            <span className="cb-num">{T("遗忘")}</span>
            <span className="cb-num">{T("优先")}</span>
            <span>{T("来源")}</span>
          </div>
          {cardsMeta.length > 0 && <div style={{ height: win.card.start * rowH * (rowH > 0 ? Math.min(1, SCROLL_CAP / (cardsMeta.length * rowH)) : 1) }} aria-hidden="true" />}
          {cardsMeta.slice(win.card.start, win.card.end).map((m) => {
            const c = rowCache.get(m.id);
            if (!c) {
              // v48.67（D111）：未取回的窗口行渲染定高占位——内容高度恒定，防止大跨度跳滚时
              // scrollHeight 瞬时塌缩约一个窗口高、scrollTop 被浏览器钳回（异步取数的窗口塌缩缺陷）
              return <div key={m.id} className="cb-row-ph" style={{ height: rowH }} aria-hidden="true" />;
            }
            return (
            <div
              key={c.id}
              className={`cb-row${selCards.has(c.id) ? " is-selected" : ""}`}
              role="row"
              onMouseDown={(ev) => {
                // v49.2（D176）：Shift+点击范围选时浏览器原生会在按下阶段扩选文字——只拦 shift 按下，click 照常派发
                if (ev.shiftKey) ev.preventDefault();
              }}
              onClick={(ev) => (ev.ctrlKey || ev.metaKey || ev.shiftKey ? toggleSel("card", c.id, ev) : setDetailId(c.id))}
              title={T("Ctrl/⌘ 点击多选 · Shift 点击范围选")}
            >
              <span className="cb-pick">
                <input
                  type="checkbox"
                  checked={selCards.has(c.id)}
                  onClick={(ev) => ev.stopPropagation()}
                  onChange={() => togglePick("card", c.id)}
                />
              </span>
              <span className="cb-front">{frontPreview(c)}</span>
              <span>{typeLabel(c.cardType)}</span>
              {/* v49.2（D176）：题面/状态/来源列各自的全文 title 与行提示互相覆盖、悬停重复刷屏，一律退役——
                  行级 title 统一为快捷键提示；行上 title 在场，F75 省略号可达性（祖先带 title 即可达）不受影响 */}
              <span>
                {statusOf(c)}
                {deferredMap.has(c.id) ? T(" · 同源暂缓") : ""}
              </span>
              <span className="mono">{dueText(c)}</span>
              <span className="cb-num mono">{c.fsrs?.reps ?? 0}</span>
              <span className="cb-num mono">{c.fsrs?.lapses ?? 0}</span>
              <span className="cb-num mono">{c.priority}</span>
              <span className="cb-src">{srcLabel(c)}</span>
            </div>
            );
          })}
          {cardsMeta.length > 0 && <div style={{ height: (cardsMeta.length - win.card.end) * rowH * (rowH > 0 ? Math.min(1, SCROLL_CAP / (cardsMeta.length * rowH)) : 1) }} aria-hidden="true" />}
        </div>
      )}

      {/* v49.16（D189）：空态块移到视图分支之后——表头恒贴工具行正下方（此前空态块在表格之前，
          零行时把表头挤到屏幕中部，用户实测）；摘录页签自带行内提示，不叠加全局空态；
          摘录页签下闪卡表恒空（cardsMeta 强制空集），表头纯噪声，一并由本条件收敛 */}
      {loaded && kindFilter !== "extract" && cardsMeta.length === 0 && (kindFilter === "card" || viewExtracts.length === 0) && (
        <div className="empty-state">
          <p className="empty-text">
            {metaAll.length === 0 ? T("还没有卡片。在阅读器中选中文字即可制卡。") : T("没有符合筛选条件的卡片。")}
          </p>
        </div>
      )}
      </>
      )}

      {/* v48.22（D58 §6.8-6）：摘录表——与闪卡同页管理（状态/优先级/下次推送/来源书） */}
      {kindFilter !== "card" && (
        <div className="cb-table" role="table" data-extract-table ref={extractTableRef}>
          <div className="cb-row cb-row-head" role="row">
            <span className="cb-pick">{T("选")}</span>
            <span>{T("摘录内容")}</span>
            <span>{T("状态")}</span>
            <span className="cb-num">{T("优先")}</span>
            <span>{T("下次推送")}</span>
            <span>{T("来源")}</span>
            <span>{T("操作")}</span>
          </div>
          {viewExtracts.length > 0 && <div style={{ height: win.extract.start * rowH * (rowH > 0 ? Math.min(1, SCROLL_CAP / (viewExtracts.length * rowH)) : 1) }} aria-hidden="true" />}
          {viewExtracts.slice(win.extract.start, win.extract.end).map((e) => (
            <div
              key={e.id}
              className={`cb-row${selExtracts.has(e.id) ? " is-selected" : ""}`}
              role="row"
              onMouseDown={(ev) => {
                // v49.2（D176）：同闪卡行——Shift+点击扩选文字的原生行为在按下阶段拦掉
                if (ev.shiftKey) ev.preventDefault();
              }}
              onClick={(ev) => (ev.ctrlKey || ev.metaKey || ev.shiftKey ? toggleSel("extract", e.id, ev) : setExtractDetailId(e.id))}
              title={T("Ctrl/⌘ 点击多选 · Shift 点击范围选")}
            >
              <span className="cb-pick">
                <input
                  type="checkbox"
                  checked={selExtracts.has(e.id)}
                  onClick={(ev) => ev.stopPropagation()}
                  onChange={() => togglePick("extract", e.id)}
                />
              </span>
              <span className="cb-front">{(e.contentMarkdown || "").slice(0, 90)}</span>
              <span>{T(extractStatusLabel(e.status))}</span>
              <span className="cb-num mono">
                {e.priority}
                {e.prioritySource === "user" ? T(" ·改") : ""}
              </span>
              <span className="mono">{nextAtText(e.topicNextAt)}</span>
              <span className="cb-src">{e.docTitle}</span>
              <span className="cb-act">
                {/* 原「学习队列」页的管理动作之一：跳转回原文位置（§6.8-8 进度安全：跳转不写阅读进度） */}
                {onJumpToDoc && e.contextRef?.documentId ? (
                  <button
                    className="btn btn-outline btn-sm"
                    data-extract-jump
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onJumpToDoc(e.contextRef!.documentId!, {
                        anchorText: e.contextRef!.anchorText || e.contentMarkdown,
                        anchorRatio: e.contextRef!.anchorRatio
                      }, "browse");
                    }}
                  >
                    {T("跳转原文")}
                  </button>
                ) : (
                  <span className="form-hint">—</span>
                )}
              </span>
            </div>
          ))}
          {viewExtracts.length > 0 && <div style={{ height: (viewExtracts.length - win.extract.end) * rowH * (rowH > 0 ? Math.min(1, SCROLL_CAP / (viewExtracts.length * rowH)) : 1) }} aria-hidden="true" />}
          {viewExtracts.length === 0 && (
            <div className="cb-row" role="row">
              <span className="cb-front">{T("没有符合筛选条件的摘录。")}</span>
            </div>
          )}
        </div>
      )}

      {/* v48.40（D80）：吸底舞台栏（与摘录/复习页同几何：72px、band-line 上缘、距窗缘 16px）——
          批量动作收入这里；全选/反选**常驻**（空选择态的入口，extract.gui 批量流程的起手），
          计数与批量动作按选中态渐进披露；data-batch-bar / 各按钮钩子与文案逐字保留 */}
      <div className="stage-bar cb-stage" data-batch-bar data-ui="stage-bar">
        <div className="cb-cluster cb-cluster-grow">
          {selCards.size + selExtracts.size === 0 ? (
            <span className="bar-hint">{T("普通点击行查看详情 · Ctrl/⌘ 多选 · Shift 范围选")}</span>
          ) : (
            <span className="mono" data-sel-count>
              {T("已选 闪卡 {a} · 摘录 {b}", { a: selCards.size, b: selExtracts.size })}
            </span>
          )}
          {kindFilter !== "extract" && (
            <>
              <button className="btn btn-outline btn-sm" data-sel-all-cards onClick={() => selectAllOf("card")}>
                {T("全选闪卡")}
              </button>
              <button className="btn btn-outline btn-sm" onClick={() => invertOf("card")}>
                {T("反选闪卡")}
              </button>
            </>
          )}
          {kindFilter !== "card" && (
            <>
              <button className="btn btn-outline btn-sm" data-sel-all-extracts onClick={() => selectAllOf("extract")}>
                {T("全选摘录")}
              </button>
              <button className="btn btn-outline btn-sm" onClick={() => invertOf("extract")}>
                {T("反选摘录")}
              </button>
            </>
          )}
          {selCards.size > 0 && (
            <>
              <button className="btn btn-outline btn-sm" disabled={batchBusy} onClick={() => void runCardBatch("suspend")}>{T("批量暂停")}</button>
              <button className="btn btn-outline btn-sm" disabled={batchBusy} onClick={() => void runCardBatch("resume")}>{T("批量恢复")}</button>
              <button className="btn btn-outline btn-sm" disabled={batchBusy} data-batch-postpone-cards onClick={() => void runCardBatch("postpone", { days: 7 })}>{T("推迟 7 天")}</button>
              {/* v48.60（D101）：批量打标/去标（v1 仅闪卡行；浮层内 TagInput + 词表建议）；v48.63（D107）受标签总开关控制 */}
              {tagsEnabled && (
              <button
                className={`btn btn-outline btn-sm${tagPop === "add" ? " btn-primary" : ""}`}
                disabled={batchBusy}
                data-batch-tag-add
                onClick={() => {
                  setTagPop(tagPop === "add" ? null : "add");
                  setTagDraft([]);
                }}
              >
                {T("打标签")}
              </button>
              )}
              {tagsEnabled && (
              <button
                className={`btn btn-outline btn-sm${tagPop === "remove" ? " btn-primary" : ""}`}
                disabled={batchBusy}
                data-batch-tag-remove
                onClick={() => {
                  setTagPop(tagPop === "remove" ? null : "remove");
                  setTagDraft([]);
                }}
              >
                {T("去标签")}
              </button>
              )}
              {/* v48.60（D102）：批量归档/恢复（生命周期；不评分、不动 FSRS） */}
              <button className="btn btn-outline btn-sm" disabled={batchBusy} data-batch-archive-cards onClick={() => void runCardBatch("archive")}>{T("归档")}</button>
              <button className="btn btn-outline btn-sm" disabled={batchBusy} data-batch-restore-cards onClick={() => void runCardBatch("restore")}>{T("恢复")}</button>
              <button className="btn btn-outline btn-sm" disabled={batchBusy} data-batch-delete-cards onClick={() => void runCardBatch("delete")}>{T("删除")}</button>
              {tagPop && (
                <span className="cb-tag-pop" data-batch-tag-pop>
                  <TagInput
                    value={tagDraft}
                    onChange={setTagDraft}
                    suggestions={tagVocab}
                    ariaLabel={tagPop === "add" ? T("要添加的标签") : T("要移除的标签")}
                    placeholder={tagPop === "add" ? T("输入要添加的标签，回车确认") : T("输入要移除的标签（含::子级）")}
                  />
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={tagDraft.length === 0 || batchBusy}
                    data-batch-tag-apply
                    onClick={() => {
                      const mode = tagPop;
                      setTagPop(null);
                      void runSetTags(mode, tagDraft);
                    }}
                  >
                    {T("应用到 {n} 张", { n: selCards.size })}
                  </button>
                </span>
              )}
            </>
          )}
          {selExtracts.size > 0 && (
            <>
              <button className="btn btn-outline btn-sm" disabled={batchBusy} data-batch-postpone-extracts onClick={() => void runExtractBatch("postponeDays", { days: 7 })}>{T("推迟 7 天")}</button>
              <button className="btn btn-outline btn-sm" disabled={batchBusy} onClick={() => void runExtractBatch("set_priority", { priority: 30 })}>{T("优先级 30")}</button>
              <button className="btn btn-outline btn-sm" disabled={batchBusy} onClick={() => void runExtractBatch("set_priority", { priority: 70 })}>{T("优先级 70")}</button>
              <button className="btn btn-outline btn-sm" disabled={batchBusy} data-batch-graduate onClick={() => void runExtractBatch("set_status", { status: "resolved" })}>{T("毕业")}</button>
              <button className="btn btn-outline btn-sm" disabled={batchBusy} onClick={() => void runExtractBatch("set_status", { status: "open" })}>{T("召回")}</button>
              {/* v48.22（D58 §6.4.2）：状态机另两个出口——归档（留痕）/ 不再关心（可召回） */}
              <button className="btn btn-outline btn-sm" disabled={batchBusy} data-batch-archive onClick={() => void runExtractBatch("set_status", { status: "archived" })}>{T("归档")}</button>
              <button className="btn btn-outline btn-sm" disabled={batchBusy} onClick={() => void runExtractBatch("set_status", { status: "dismissed" })}>{T("不再关心")}</button>
              <button className="btn btn-outline btn-sm" disabled={batchBusy} data-batch-delete-extracts onClick={() => void runExtractBatch("delete")}>{T("删除")}</button>
            </>
          )}
          {selCards.size + selExtracts.size > 0 && (
            <button
              className="btn btn-outline btn-sm"
              onClick={() => {
                setSelCards(new Set());
                setSelExtracts(new Set());
              }}
            >
              {T("清除选择")}
            </button>
          )}
          {batchNote && <span className="form-hint" data-batch-note>{batchNote}</span>}
        </div>
        {selExtracts.size > 0 && (
          <div className="cb-cluster">
            <input className="cb-search cb-find" data-find-input placeholder={T("查找")} value={findText} onChange={(e) => setFindText(e.target.value)} />
            <input className="cb-search cb-find" data-replace-input placeholder={T("替换为")} value={replaceText} onChange={(e) => setReplaceText(e.target.value)} />
            <button className="btn btn-outline btn-sm" disabled={batchBusy} data-find-replace onClick={() => void runFindReplace()}>{T("正文查找替换")}</button>
          </div>
        )}
      </div>

      {detail && (
        <CardDetail
          card={detail}
          siblingCards={siblingRows}
          lineageCards={lineageCards}
          extracts={extracts}
          deferredMap={deferredMap}
          deferredNote={
            (() => {
              const r = deferredMap.get(detail.id);
              if (!r) return undefined;
              const front = r.siblingFront ? `${r.siblingFront.slice(0, 20)}${r.siblingFront.length > 20 ? "…" : ""}` : "";
              return r.kind === "reviewed"
                ? T("同源卡今日已评分：「{front}」，明日解封", { front })
                : front
                  ? T("与今日已放行的「{front}」同源，明日解封", { front })
                  : T("与今日已放行的同源卡同源，明日解封");
            })()
          }
          onClose={() => setDetailId(null)}
          onJumpToDoc={onJumpToDoc}
          onOpenLeech={(c) => setLeechTarget(c)}
          onOpenAnchorFilter={(extractId) => {
            // v48.61（D103）：血缘树节点「查看卡片」——就地切锚点筛选并关详情（D87 既有入口）
            setDetailId(null);
            setAnchorFilter(String(extractId));
          }}
          onOpenCard={(id) => setDetailId(id)}
        />
      )}

      {/* v48.40（D80）：摘录详情——与 CardDetail 同构（全文 + meta + 维护动作），动作复用批量条同一 IPC */}
      {extractDetail && (
        <ExtractDetail
          extract={extractDetail}
          onClose={() => setExtractDetailId(null)}
          onJumpToDoc={onJumpToDoc}
          onChanged={() => refresh()}
        />
      )}

      {leechTarget && (
        <LeechWizard
          card={leechTarget}
          onClose={() => setLeechTarget(null)}
          onDone={() => {
            setLeechTarget(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

// ---------- 摘录详情（v48.40 / D80：与 CardDetail 同构；动作复用批量条同一 IPC，单条＝ids 长度 1） ----------
// documentId：listAllExtracts 映射为驼峰 `documentId`；listDueExtracts 原样透传 `document_id`——两形态都接
type ExtractRow = DueTopic & {
  comment?: string | null;
  quoteRangeJson?: string | null;
  createdAt?: number;
  documentId?: string | null;
  document_id?: string | null;
};

export function ExtractDetail({
  extract,
  onClose,
  onJumpToDoc,
  onChanged
}: {
  extract: ExtractRow;
  onClose: () => void;
  onJumpToDoc?: JumpToDoc;
  onChanged: () => Promise<void> | void;
}) {
  const T = useT();
  const panelRef = useDialogA11y<HTMLDivElement>(onClose);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // quoteRange 是父卡 content_markdown 坐标（§1.1）；坏 JSON 不抛（与 listAllExtracts 同口径）
  const ranges = (() => {
    try {
      const parsed = JSON.parse(String(extract.quoteRangeJson ?? "null"));
      return Array.isArray(parsed) ? (parsed as Array<{ start: number; end: number }>) : null;
    } catch {
      return null;
    }
  })();

  async function run(op: string, payload?: unknown, opts?: { confirm?: string; closeAfter?: boolean }) {
    if (opts?.confirm && !window.confirm(opts.confirm)) return;
    setBusy(true);
    setNote(null);
    try {
      const r = (await readingWorkflow.batch(op as never, [extract.id], payload as never)) as { ok?: boolean; reason?: string };
      if (!r?.ok) {
        setNote(r?.reason || T("操作失败，未执行"));
        return;
      }
      await onChanged();
      if (opts?.closeAfter) onClose();
    } finally {
      setBusy(false);
    }
  }

  function jump() {
    const documentId = extract.contextRef?.documentId || extract.documentId || extract.document_id || "";
    if (!documentId || !onJumpToDoc) return;
    onJumpToDoc(
      documentId,
      {
        anchorText: extract.contextRef?.anchorText || extract.contentMarkdown,
        anchorRatio: extract.contextRef?.anchorRatio
      },
      "browse"
    );
  }

  const meta: [string, string][] = [
    [T("状态"), T(extractStatusLabel(extract.status))],
    [T("优先级"), `P${extract.priority}${extract.prioritySource === "user" ? T(" · 改") : ""}`],
    [T("下次推送"), nextAtText(extract.topicNextAt)],
    [T("来源"), extract.docTitle || "—"],
    [T("引文"), ranges?.length ? T("{n} 段（{type}）", { n: ranges.length, type: extract.parentType === "extract" ? T("父卡正文坐标") : T("本条正文") }) : "—"],
    [T("批注"), extract.comment || "—"],
    [T("创建时间"), extract.createdAt ? new Date(extract.createdAt).toLocaleString() : "—"]
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" ref={panelRef} role="dialog" aria-modal="true" data-ui="dialog" aria-label={T("摘录详情")} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{T("摘录详情")}</h2>
          <button className="icon-btn modal-close" title={T("关闭")} onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
        <div className="modal-scroll">
          {/* 多段摘录＝各段 \n\n 拼接（D61/D78 落库形态），whitespace 保留原文换行 */}
          <div className="extract-detail-content">{extract.contentMarkdown}</div>

          <dl className="cb-meta">
            {meta.map(([k, v]) => (
              <Fragment key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </Fragment>
            ))}
          </dl>

          {note && <p className="form-hint" data-extract-detail-note>{note}</p>}

          <div className="cb-actions">
            {(extract.contextRef?.documentId || extract.documentId || extract.document_id) && onJumpToDoc && (
              <button className="btn btn-outline btn-sm" data-extract-detail-jump onClick={jump}>
                {T("跳转原文")}
              </button>
            )}
            <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => void run("postponeDays", { days: 7 })}>
              {T("推迟 7 天")}
            </button>
            <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => void run("set_priority", { priority: 30 })}>
              {T("优先级 30")}
            </button>
            <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => void run("set_priority", { priority: 70 })}>
              {T("优先级 70")}
            </button>
            <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => void run("set_status", { status: "resolved" })}>
              {T("毕业")}
            </button>
            <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => void run("set_status", { status: "open" })}>
              {T("召回")}
            </button>
            <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => void run("set_status", { status: "archived" })}>
              {T("归档")}
            </button>
            <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => void run("set_status", { status: "dismissed" })}>
              {T("不再关心")}
            </button>
            <button
              className="btn btn-outline btn-sm"
              disabled={busy}
              onClick={() => void run("delete", undefined, { confirm: T("删除这条摘录？（软删，可在备份中找回）"), closeAfter: true })}
            >
              {T("删除")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- 行详情（v19：Anki 浏览器的卡片信息 + 维护动作） ----------
// 卡面预览复用复习页 CardFace（showBack + onEdit → EditableText 内联编辑，cloze 自动回填挖空语法）；
// 编辑只改文案不动 FSRS（updateCard 未传 fsrs 时保留原值，§7.2）。
// v48.61（D103，D94 设计稿 §3.1–3.3）：新增三个**只读派生**区块——来源谱系（血缘树）、
// 生成信息区（AI 卡）+「用当前提示词重新生成」、同源组区；零写路径（f32 矩阵不回退）。
function CardDetail({
  card,
  siblingCards,
  lineageCards,
  extracts,
  deferredMap,
  onClose,
  onJumpToDoc,
  onOpenLeech,
  onOpenAnchorFilter,
  onOpenCard,
  deferredNote
}: {
  card: BrowserCard;
  /** v48.67（D111）：同源组全行（cards:siblingGroup 按需取，sibling_key 为空为空数组） */
  siblingCards: BrowserCard[];
  /** v48.67（D111）：血缘树制卡计数的数据面（轻量行集的 extractId 投影） */
  lineageCards: ReadonlyArray<{ contextRef: { extractId: string } | null }>;
  /** 摘录行（血缘树邻接表 + 引文标签的数据面；workflowAPI.listAll 口径） */
  extracts: DueTopic[];
  /** 今日同源暂缓清单（同源组「今日暂缓」徽标；与复习队列同一视图口径） */
  deferredMap: Map<string, NonNullable<TodayQueue["deferred"][number]["deferReason"]>>;
  onClose: () => void;
  onJumpToDoc?: JumpToDoc;
  onOpenLeech: (card: BrowserCard) => void;
  /** 血缘树节点「查看卡片」→ 浏览器锚点筛选（D87 既有入口；父组件就地设内部筛选锚） */
  onOpenAnchorFilter: (extractId: string) => void;
  /** 同源组行点击 → 切换详情到该卡 */
  onOpenCard: (id: string) => void;
  /** v34（M12）：今日同源暂缓原因（不在暂缓组时为 undefined） */
  deferredNote?: string;
}) {
  const T = useT();
  const panelRef = useDialogA11y<HTMLDivElement>(onClose);
  const [issues, setIssues] = useState<CardIssueRecord[]>([]);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  // v48.61（D103）：生成信息区（AI 卡）——cards:genInfo 只读 join；重新生成确认面板开关
  const [genInfo, setGenInfo] = useState<CardGenInfo | null>(null);
  const [regenOpen, setRegenOpen] = useState(false);
  // v48.60（D101）：卡详情标签区——chips 展示 + 单卡编辑（ids 长度 1 = 单卡，D80 先例）
  const [tagList, setTagList] = useState<string[]>(card.tags ?? []);
  const [tagEditing, setTagEditing] = useState(false);
  const [tagDraft, setTagDraft] = useState<string[]>([]);
  const [tagVocab, setTagVocab] = useState<TagVocabEntry[]>([]);
  const isArchived = card.status === "archived";
  // v48.63（D107）：标签功能总开关——详情标签区受其控制（数据不动）
  const tagsEnabled = useTagsEnabled();

  // v48.61（D103）：血缘树——复用 D87 邻接表口径（workflow 行 parentExtractId）+ D85 聚合计数
  const lineage = useMemo(
    () =>
      buildLineageTree({
        extractId: card.contextRef?.extractId ?? null,
        extracts: extracts as LineageExtractRow[],
        cards: lineageCards
      }),
    [card.contextRef?.extractId, extracts, lineageCards]
  );

  // v48.61（D103）：同源组——sibling_key 非空时列组内全部卡（含归档行如实展示）；due 升序同队列序
  const siblingMembers = useMemo(() => {
    if (!card.siblingKey) return [];
    return siblingCards
      .filter((c) => c.siblingKey && c.siblingKey === card.siblingKey)
      .sort((a, b) => (a.fsrs?.due ?? 0) - (b.fsrs?.due ?? 0));
  }, [card.siblingKey, siblingCards]);

  useEffect(() => {
    setTagList(card.tags ?? []);
    setTagEditing(false);
  }, [card.id, card.updatedAt]);

  useEffect(() => {
    if (!tagEditing) return;
    let cancelled = false;
    window.cardsAPI?.listTags?.().then((l) => {
      if (!cancelled) setTagVocab(l ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [tagEditing]);

  async function saveTags() {
    await cardsApi.setTags([{ id: card.id, tags: tagDraft }]);
    setTagList(tagDraft);
    setTagEditing(false);
    eventBus.emit("cards/changed");
  }

  async function toggleArchive() {
    await cardsApi.batch(isArchived ? "restore" : "archive", [card.id]);
    eventBus.emit("cards/changed");
  }

  useEffect(() => {
    let cancelled = false;
    cardsApi.listIssues(card.id).then((list) => {
      if (!cancelled) setIssues(list.filter((i) => i.status === "open"));
    });
    return () => {
      cancelled = true;
    };
  }, [card.id, card.updatedAt]);

  // v48.61（D103）：生成信息区数据（AI 卡才读；只读 join，零写路径）
  useEffect(() => {
    setGenInfo(null);
    if (card.generatedBy !== "ai") return;
    let cancelled = false;
    cardsApi.genInfo(card.id).then((info) => {
      if (!cancelled) setGenInfo(info);
    });
    return () => {
      cancelled = true;
    };
  }, [card.id, card.generatedBy, card.updatedAt]);

  async function handleEdit(patch: { frontMarkdown?: string; backMarkdown?: string; noteText?: string }) {
    await cardsApi.update({ ...card, ...patch });
    eventBus.emit("cards/changed");
  }

  async function toggleSuspend() {
    await cardsApi.setSuspended(card.id, !card.leech?.suspended, card.leech?.suspended ? undefined : "browse-suspend");
    eventBus.emit("cards/changed");
  }

  async function postpone(days: number) {
    const base = Math.max(Date.now(), card.fsrs?.due ?? Date.now());
    await cardsApi.update({ ...card, fsrs: { ...card.fsrs, due: base + days * 86400000 } });
    eventBus.emit("cards/changed");
  }

  async function resetNew() {
    if (!window.confirm(T("重置为新卡？该卡的调度进度（稳定度/难度/复习次数/遗忘次数）将被清零。"))) return;
    await cardsApi.update({ ...card, fsrs: { state: "new", due: Date.now(), lapses: 0 } });
    eventBus.emit("cards/changed");
  }

  async function handleDelete() {
    if (!window.confirm(`${T("确定删除这张卡片？")}\n\n${card.frontMarkdown || card.noteText}`)) return;
    await cardsApi.remove(card.id);
    eventBus.emit("cards/changed");
    onClose();
  }

  function jump() {
    if (!card.contextRef?.documentId || !onJumpToDoc) return;
    onJumpToDoc(
      card.contextRef.documentId,
      {
        anchorText: card.contextRef.anchorText || card.frontMarkdown || card.noteText,
        anchorRatio: card.contextRef.anchorRatio,
        cfi: card.contextRef.cfi,
        chapterIndex: card.contextRef.chapterIndex,
        pageIndex: card.contextRef.pageIndex,
        imageAnchor: card.contextRef.imageAnchor,
        occlusion: card.occlusionJson ? { rects: card.occlusionJson.rects, shapes: card.occlusionJson.shapes, regionScope: card.occlusionJson.regionScope, cardOrd: card.cardOrd, assetPath: card.occlusionJson.assetPath } : undefined
      },
      "browse"
    );
  }

  // v48.61（D103）：血缘树节点跳原文（与卡跳原文同链路；锚点信息取自该摘录行，§6.8-8 进度不变量由既有链路保证）
  function jumpNode(n: LineageNode) {
    if (!n.documentId || !onJumpToDoc) return;
    onJumpToDoc(
      n.documentId,
      { anchorText: n.anchorText || n.label, anchorRatio: n.anchorRatio ?? undefined },
      "browse"
    );
  }

  const f = card.fsrs ?? {};
  const meta: [string, string][] = [
    [T("类型"), typeLabel(card.cardType)],
    [T("状态"), statusOf(card) + (deferredNote ? T("（{note}）", { note: deferredNote }) : "")],
    [T("到期"), dueText(card)],
    [T("复习 / 遗忘"), T("{reps} 次 / {lapses} 次", { reps: f.reps ?? 0, lapses: f.lapses ?? 0 })],
    [
      T("稳定度 / 难度"),
      f.stability != null && f.difficulty != null ? `${f.stability.toFixed(2)} / ${f.difficulty.toFixed(2)}` : "—"
    ],
    [T("优先级"), `P${card.priority}`],
    [T("来源"), srcLabel(card)],
    [T("领域"), (card.domain ?? []).join("、") || "—"],
    // v40（K1）：legacy knowledge_point_id（正式 KP 之外的原值；归一提案见「知识点」页签）
    [T("知识点"), card.knowledgePointId || "—"],
    [T("生成方式"), card.generatedBy === "ai" ? T("AI 生成") : T("手动")],
    [T("创建时间"), new Date(card.createdAt).toLocaleString()]
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" ref={panelRef} role="dialog" aria-modal="true" data-ui="dialog" aria-label={T("卡片详情")} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{T("卡片详情")}</h2>
          <button className="icon-btn modal-close" title={T("关闭")} onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
        <div className="modal-scroll">
          <CardFace card={card} showBack onReveal={() => {}} onEdit={handleEdit} />
          {/* v48.61（D104）：背面辅助字段区（助记/例子/来源，app.cardFaceExtras 三开关）——与复习页同一组件自动继承 */}
          <CardFaceExtrasBlock card={card} />

          {/* v46（M14-UM2，§6.7.3）：记忆溯源——显示所引记忆行与校验状态；已入库卡不随记忆文件改动自动改写 */}
          {card.memoryRefJson && (
            <div className="cb-issues">
              <span className={`lint ${card.memoryRefJson.verified ? "lint-info" : "lint-warn"}`}>
                {card.memoryRefJson.verified ? T("情境来自记忆") : T("情境来源存疑（来源可能已变更）")}
              </span>
              <div className="mono fs-meta mt-2">
                {T("引用记忆行：")}{card.memoryRefJson.line}
              </div>
            </div>
          )}

          <dl className="cb-meta">
            {meta.map(([k, v]) => (
              <Fragment key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </Fragment>
            ))}
          </dl>

          {/* v48.61（D103）：生成信息区（AI 卡）——批次/提示词/当时质检如实展示 + 重新生成入口；手动卡无批次区（meta 生成方式=手动） */}
          {card.generatedBy === "ai" && (
            <div className="cb-geninfo" data-testid="card-detail-geninfo">
              <p className="cb-section-title">{T("生成信息")}</p>
              {genInfo ? (
                <>
                  <dl className="cb-meta cb-gen-meta">
                    <dt>{T("生成批次")}</dt>
                    <dd data-testid="geninfo-batch">
                      {genInfo.batch ? new Date(genInfo.batch.createdAt).toLocaleString() : T("—（批次缺失）")}
                      {genInfo.batch?.model ? ` · ${genInfo.batch.model}` : ""}
                    </dd>
                    <dt>{T("提示词")}</dt>
                    <dd data-testid="geninfo-template">
                      {genInfo.template
                        ? `${genInfo.template.scope} · ${genInfo.template.name} · v${genInfo.template.version}`
                        : "—"}
                    </dd>
                    <dt>{T("当时质检")}</dt>
                    <dd data-testid="geninfo-lint">
                      {(() => {
                        const lint = genInfo.issues.filter((i) => i.source === "lint");
                        if (lint.length === 0) return T("无提示");
                        const open = lint.filter((i) => i.status === "open").length;
                        return open ? T("{n} 条（{m} 条未处理）", { n: lint.length, m: open }) : T("{n} 条（均已处理）", { n: lint.length });
                      })()}
                    </dd>
                  </dl>
                  {card.contextRef?.extractId ? (
                    <button className="btn btn-outline btn-sm" data-testid="regen-cards" onClick={() => setRegenOpen(true)}>
                      {T("用当前提示词重新生成")}
                    </button>
                  ) : (
                    <span className="form-hint">{T("无来源摘录，无法重新生成")}</span>
                  )}
                </>
              ) : (
                <p className="form-hint">{T("生成信息加载中…")}</p>
              )}
            </div>
          )}

          {/* v48.61（D103）：来源谱系（血缘树）——本卡所属摘录向上到根、向下到叶；D85 聚合计数；空态如实显示「无来源锚」 */}
          {lineage.hasSource ? (
            <div className="cb-lineage" data-testid="card-detail-lineage">
              <p className="cb-section-title">{T("来源谱系")}</p>
              <ul className="cb-lineage-list">
                {[...lineage.ancestors, ...lineage.descendants].map((n) => (
                  <li
                    key={n.id}
                    className={"cb-lineage-item" + (n.isCurrent ? " current" : "")}
                    style={{ paddingLeft: `calc(var(--sp-3) * ${Math.min(n.depth, 6)})` }}
                  >
                    <span className="cb-lineage-label">{n.label || T("（空引文）")}</span>
                    <span className="cb-lineage-count mono" title={T("该节点及全部子孙摘录上的卡数（D85 聚合口径）")}>
                      {n.count}
                    </span>
                    {n.documentId && onJumpToDoc && (
                      <button className="btn btn-outline btn-sm" onClick={() => jumpNode(n)} title={T("跳转到该摘录的原文位置")}>
                        {T("跳原文")}
                      </button>
                    )}
                    <button
                      className="btn btn-outline btn-sm"
                      data-testid="lineage-view-cards"
                      onClick={() => onOpenAnchorFilter(n.id)}
                      title={T("按该锚点筛选浏览器（含全部子层级）")}
                    >
                      {T("查看卡片")}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="cb-lineage" data-testid="card-detail-lineage-empty">
              <p className="form-hint">{T("无来源锚")}</p>
            </div>
          )}

          {/* v48.61（D103）：同源组（§4.16）——组内全部卡列表，本卡高亮；复习页「同源暂缓」提示保持原样（不加点跳） */}
          {siblingMembers.length > 0 && (
            <div className="cb-sibling" data-testid="card-detail-sibling">
              <p className="cb-section-title">{T("同源组（{n} 张）", { n: siblingMembers.length })}</p>
              <ul className="cb-sibling-list">
                {siblingMembers.map((m) => (
                  <li
                    key={m.id}
                    className={"cb-sibling-item" + (m.id === card.id ? " current" : "")}
                    data-testid="sibling-row"
                    onClick={() => {
                      if (m.id !== card.id) onOpenCard(m.id);
                    }}
                    title={m.id === card.id ? undefined : T("查看这张同源卡的详情")}
                  >
                    <span className="mono">{typeLabel(m.cardType)}</span>
                    <span className="cb-sibling-front">{frontPreview(m).replace(/\s+/g, " ").slice(0, 40) || T("（空题面）")}</span>
                    <span>{statusOf(m)}</span>
                    <span className="mono">{dueText(m)}</span>
                    {deferredMap.has(m.id) && <span className="lint lint-warn">{T("今日暂缓")}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* v48.60（D101）：标签区——chips + 单卡编辑（正面永不显示标签，详情属编辑域不受此限）；
              v48.63（D107）：标签功能总开关关闭时整块不渲染 */}
          {tagsEnabled && (
          <div className="cb-tags" data-testid="card-detail-tags">
            <span className="cb-tags-label">{T("标签")}</span>
            {tagEditing ? (
              <span className="cb-tags-editor">
                <TagInput value={tagDraft} onChange={setTagDraft} suggestions={tagVocab} ariaLabel={T("标签")} />
                <button className="btn btn-primary btn-sm" data-tags-save onClick={() => void saveTags()}>
                  {T("保存")}
                </button>
                <button className="btn btn-outline btn-sm" onClick={() => setTagEditing(false)}>
                  {T("取消")}
                </button>
              </span>
            ) : (
              <span className="cb-tags-view">
                {tagList.length > 0 ? (
                  <span className="tag-chips">
                    {tagList.map((t) => (
                      <span key={t} className="tag-chip tag-chip-static">
                        {t}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="form-hint">{T("无标签")}</span>
                )}
                <button
                  className="btn btn-outline btn-sm"
                  data-tags-edit
                  onClick={() => {
                    setTagDraft(tagList);
                    setTagEditing(true);
                  }}
                >
                  {T("编辑")}
                </button>
              </span>
            )}
          </div>
          )}

          {issues.length > 0 && (
            <div className="cb-issues">
              <p className="cb-issues-title">{T("质检问题（CardLint / 相似检索）")}</p>
              {issues.map((it) => (
                <div key={it.id} className="cb-issue-line">
                  <span className={`lint lint-${it.severity}`}>
                    {it.rule_id} {it.message}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="cb-actions">
            {card.contextRef?.documentId && onJumpToDoc && card.contextRef.imageSource !== "library" && (
              // v35：资源库选图卡（imageSource="library"）隐藏跳转；旧卡无锚点置灰提示，不再跳回开头
              hasSourceAnchor(card.contextRef) ? (
                <button className="btn btn-outline btn-sm" onClick={jump}>
                  {T("跳转原文")}
                </button>
              ) : (
                <button className="btn btn-outline btn-sm" disabled title={T("该卡制卡时未记录原文位置（旧卡），无法跳转")}>
                  {T("跳转原文")}
                </button>
              )
            )}
            {card.cardType === "imageOcclusion" && card.occlusionJson && (
              <button className="btn btn-outline btn-sm" onClick={() => setLightboxOpen(true)}>
                {T("查看原图")}
              </button>
            )}
            <button className="btn btn-outline btn-sm" onClick={toggleSuspend}>
              {card.leech?.suspended ? T("恢复调度") : T("暂停调度")}
            </button>
            {/* v48.60（D102）：生命周期归档/恢复（与暂停调度正交；不评分、不动 FSRS） */}
            <button className="btn btn-outline btn-sm" data-detail-archive onClick={toggleArchive}>
              {isArchived ? T("恢复（解除归档）") : T("不再关心")}
            </button>
            <button className="btn btn-outline btn-sm" onClick={() => postpone(1)}>
              {T("推迟 1 天")}
            </button>
            <button className="btn btn-outline btn-sm" onClick={() => postpone(7)}>
              {T("推迟 7 天")}
            </button>
            <button className="btn btn-outline btn-sm" onClick={resetNew}>
              {T("重置为新卡")}
            </button>
            {card.leech?.isLeech && (
              <button className="btn btn-secondary btn-sm" onClick={() => onOpenLeech(card)}>
                {T("六步处理")}
              </button>
            )}
            <button className="btn btn-outline btn-sm review-delete" onClick={handleDelete}>
              {T("删除")}
            </button>
          </div>
          <p className="form-hint">{T("题面与答案可直接点击编辑（失焦落库，挖空卡自动回填挖空语法）；复习评分请回到「复习」页。")}</p>
          {lightboxOpen && card.occlusionJson && (
            <ImageLightbox
              assetPath={card.occlusionJson.assetPath}
              rects={card.occlusionJson.rects}
              shapes={card.occlusionJson.shapes}
              regionScope={card.occlusionJson.regionScope}
              cardOrd={card.cardOrd}
              onClose={() => setLightboxOpen(false)}
            />
          )}
          {/* v48.61（D103）：「用当前提示词重新生成」确认面板——产物走完整接受流（CardLint + S1），新建卡不覆盖原卡 */}
          {regenOpen && (
            <RegenCardsModal
              card={card}
              batchScope={genInfo?.batch?.scope ?? null}
              onClose={() => setRegenOpen(false)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- 卡面渲染（qa / cloze / seq / imageOcclusion；ReviewView 连续刷题共用） ----------
// 内联编辑（v11.2 重写）：EditableText 是 React 不描述子节点的"裸壳"div——挂载时命令式写入纯文本，
// 点击即出光标，失焦读回 innerText 落库。React 永远不 reconcile 它的子节点，
// 彻底规避 contentEditable 与 ReactMarkdown 共管 DOM 导致的「优绩:」叠加与 removeChild 崩溃。
function EditableText({
  value,
  onCommit,
  className
}: {
  value: string;
  onCommit: (text: string) => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const initial = useRef(value);
  if (initial.current !== value) {
    // 外部值变化（换卡）时重置壳内文本
    initial.current = value;
    if (ref.current && document.activeElement !== ref.current) ref.current.innerText = value;
  }
  useEffect(() => {
    if (ref.current) ref.current.innerText = value;
    // 仅挂载/换值时写入一次；编辑过程中 React 不触碰 DOM
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div
      ref={ref}
      className={`review-editable${className ? " " + className : ""}`}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      onFocus={(e) => {
        // 聚焦时把光标置于点击处由浏览器默认行为处理；无需干预
        void e;
      }}
      onBlur={(e) => {
        const text = e.currentTarget.innerText.replace(/\n{3,}/g, "\n\n").trim();
        if (text && text !== initial.current.trim()) {
          initial.current = text;
          onCommit(text);
        } else if (!text) {
          // 清空不落库，恢复原值
          e.currentTarget.innerText = initial.current;
        }
      }}
      onKeyDown={(e) => {
        if (isImeComposing(e)) return; // 组字中的 Esc 属于输入法（取消组字），不失焦
        if (e.key === "Escape") (e.target as HTMLElement).blur();
      }}
    />
  );
}

export function CardFace({
  card,
  showBack,
  onReveal,
  onEdit
}: {
  card: CardRecord;
  showBack: boolean;
  /** 翻面回调（可缺省：复习页改成只走底栏「显示答案」按钮，点卡面不翻面——2026-10-01） */
  onReveal?: () => void;
  onEdit?: (patch: {
    frontMarkdown?: string;
    backMarkdown?: string;
    noteText?: string;
  }) => Promise<void> | void;
}) {
  const T = useT();
  const md = (s: string) => (
    <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{s}</ReactMarkdown>
  );

  // D88 §7.3：双面常挂 + 非当前面 inert（可达性/编辑安全硬性）——useLayoutEffect 在绘制前对调，
  // 保证「EditableText 只在背面可编辑」的契约在两种动效路径（3D 翻卡 / reduce 瞬时）下都成立；
  // reduce 降级的视觉切换（非当前面 display:none）由 theme.css reduce 块承担，inert 与动效无关。
  const frontFaceRef = useRef<HTMLDivElement>(null);
  const backFaceRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // 非当前面挂 inert：正面态（showBack=false）⇒ 背面 inert；翻到背面 ⇒ 正面 inert
    if (frontFaceRef.current) frontFaceRef.current.inert = showBack;
    if (backFaceRef.current) backFaceRef.current.inert = !showBack;
  }, [showBack]);

  /** 双面包装：两面同格等高（grid 1/1），flipped 类＝翻面姿态（transition 由 CSS 管）。
      正面点击=翻面（onReveal 在场且未翻面时；复习页不传 onReveal ⇒ 点卡面不翻面，2026-10-01 口径不变）。 */
  function flipWrap(front: ReactNode, back: ReactNode) {
    return (
      <div className={`review-flip${showBack ? " flipped" : ""}`}>
        <div
          ref={frontFaceRef}
          className="review-face"
          aria-hidden={!showBack || undefined}
          onClick={!showBack && onReveal ? onReveal : undefined}
        >
          {front}
        </div>
        <div ref={backFaceRef} className="review-face review-back" aria-hidden={showBack || undefined}>
          {back}
        </div>
      </div>
    );
  }

  const frontText = card.frontMarkdown || card.noteText;

  // v32（M7）单词卡发音按钮：听音卡嵌题面内、其余卡嵌答案区（dict_json.kind 分流；
  // 存量无 kind 卡按 front 前缀「发音：」判定）。stopPropagation 防触发翻面。
  const dj = card.dictJson;
  const isListeningVocab = !!dj && (dj.kind ? dj.kind === "listening" : frontText.startsWith("发音："));
  const speakBtn = dj ? (
    <button
      className="vocab-speak-btn"
      title={T("播放发音")}
      onClick={(e) => {
        e.stopPropagation();
        void playVocabAudio(dj);
      }}
    >
      <IconVolume />
    </button>
  ) : null;

  // 图片挖空卡（v16 展示规范）：正面 = 原图 + 主题色遮挡块（考察区域 accent 色、其余区域 ink 色）；
  // 答案面 = 原始图片（无任何遮挡覆盖）+ 答案文本。
  // v25：遮挡块支持矩形/椭圆/多边形（shapes 精确轮廓；无 shapes 的存量卡自动降级为 rects 矩形）
  if (card.cardType === "imageOcclusion" && card.occlusionJson) {
    // v29（D26）：看图问答卡（rects 空数组挂图 + frontMarkdown 题面）——正面图下方渲染题面文字
    // v30（D28，用户拍板）：题面正反面都显示——背面 = 图 + 题面 + 答案（翻面后题面不消失）
    const hasFrontText = !!(card.frontMarkdown && card.frontMarkdown !== "图中遮挡区域对应的是什么？");
    // D88 §7.3 双面化：正面 = 遮挡图 + 只读题面（编辑器只在背面在场，GUIDE §5.4 契约）；
    // 背面 = 原图（无遮挡层）+ 可编辑题面 + 答案。
    return flipWrap(
      <>
        <div className="occlusion-stage">
          <img src={card.occlusionJson.assetPath} alt="" className="occlusion-img" />
          <OcclusionShapes occlusion={card.occlusionJson} cardOrd={card.cardOrd} hidden={false} />
        </div>
        {hasFrontText && <div className="review-front-text">{card.frontMarkdown}</div>}
        {/* R8（D98/v48.57）：复习页翻面只走底栏「显示答案」（onReveal 不传＝卡面无按钮——
        此前渲染出无 onClick 的死按钮）；onReveal 在场的调用方（若有）仍显示 */}
        {!showBack && onReveal && (
          <button className="btn btn-primary" onClick={onReveal}>{T("显示答案")}</button>
        )}
      </>,
      <>
        <div className="occlusion-stage">
          <img src={card.occlusionJson.assetPath} alt="" className="occlusion-img" />
        </div>
        {hasFrontText && (
          <div className="review-front-text">
            {onEdit ? (
              <EditableText value={card.frontMarkdown} onCommit={(t) => onEdit({ frontMarkdown: t, noteText: t })} />
            ) : (
              card.frontMarkdown
            )}
          </div>
        )}
        <div className="review-back-a">
          {onEdit ? (
            <EditableText value={card.backMarkdown} onCommit={(t) => onEdit({ backMarkdown: t })} />
          ) : (
            card.backMarkdown
          )}
        </div>
      </>
    );
  }

  if (card.cardType === "cloze") {
    // v30（D27）同答/分答两形态（用户拍板）：
    //   同答卡（clozeOrds 空 = 遮全部 ord；存量多空卡与「组内同时回忆」语义）——
    //     正面所有空一起挖成[…]，背面按文本顺序列出每个空的答案；
    //   分答卡（per-blank 拆卡后每张 clozeOrds=[自己的 ord]）——只遮自己那空，
    //     其余空以原文正常显示在正面，背面只给本空答案。
    const parsed = parseCloze(frontText);
    const maskOrds = card.clozeOrds && card.clozeOrds.length > 0 ? card.clozeOrds : parsed.ords;
    const masked = parsed.renderDetail(maskOrds);
    // 背面问题区与正面共用同一渲染——翻面前后逐字相同，挖空始终遮蔽（用户需求）
    const questionText = masked.text;
    const maskedOrds = masked.maskedOrds;
    // 答案区（v15 修复）：用户编辑过的 backMarkdown 优先显示；否则按遮蔽顺序显示各空答案
    const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩";
    const answers = extractClozeAnswers(frontText, maskedOrds);
    const clozeAnswer =
      card.backMarkdown && card.backMarkdown.trim()
        ? card.backMarkdown
        : answers.length > 1
          ? answers.map((a, i) => `${CIRCLED[i] ?? "·"} ${a}`).join("　")
          : answers[0] ?? "";
    // 问题区编辑（v12.4）：翻面后可改。用户编辑的是显示文本（当前挖空为[…]），
    // 落库时按文本顺序把第 i 个[…]还原为第 i 个被遮 ord 的原挖空语法（多空同答卡逐个还原）；
    // 其余挖空按显示文本保留（若被改动则该挖空降级为普通文字）
    const commitQuestion = (t: string) => {
      const edit = onEdit;
      if (!edit) return;
      let restored = t;
      for (const o of maskedOrds) {
        const pos = restored.indexOf("[…]");
        if (pos === -1) break;
        const syntax = frontText.match(new RegExp(`\\{\\{c${o}::(.*?)(?:::(.*?))?\\}\\}`));
        if (syntax) restored = restored.slice(0, pos) + syntax[0] + restored.slice(pos + "[…]".length);
      }
      edit({ frontMarkdown: restored, noteText: restored });
    };
    // D88 §7.3 双面化：正面只读；背面 = 题面（同渲染，挖空始终遮蔽，用户需求）+ 答案。
    // 题面编辑器（EditableText）只挂背面——非当前面 inert ⇒ 翻面前不可聚焦（§5.4 契约）。
    return flipWrap(
      <>
        <div className="review-front">
          {card.contextPrefix && <span className="review-prefix mono">{card.contextPrefix}</span>}
          {md(questionText)}
        </div>
      </>,
      <>
        <div className="review-back-q">
          {card.contextPrefix && <span className="review-prefix mono">{card.contextPrefix}</span>}
          {onEdit ? (
            <EditableText value={questionText} onCommit={commitQuestion} />
          ) : (
            md(questionText)
          )}
        </div>
        <div className="review-back-a">
          {onEdit ? (
            <EditableText value={clozeAnswer} onCommit={(t) => onEdit({ backMarkdown: t })} />
          ) : (
            clozeAnswer
          )}
          {/* v32（M7）：单词挖空卡（非听音）发音按钮入答案字段 */}
          {dj && !isListeningVocab && speakBtn}
        </div>
      </>
    );
  }

  // v16（D18）：翻转问答卡 = 制卡手段，创建时即拆为两张独立 qa 卡；
  // 不存在复习期形态变化的卡片类型，一切卡设计以 FSRS 为核心。

  // D88 §7.3 双面化：背面 = 题面（翻面前后视觉连续，用户反馈 #1）+ 答案；听音卡发音按钮
  // 随题面进背面（正面翻走后仍可播——单面时代它常驻在题面字段）。
  return flipWrap(
    <>
      <div className="review-front">
        {card.contextPrefix && <span className="review-prefix mono">{card.contextPrefix}</span>}
        {md(frontText)}
        {/* v32（M7）：听音卡发音按钮嵌入题面字段（存量无 kind 卡按 front 前缀「发音：」判定） */}
        {dj && isListeningVocab && speakBtn}
      </div>
    </>,
    <>
      <div className="review-back-q">
        {card.contextPrefix && <span className="review-prefix mono">{card.contextPrefix}</span>}
        {onEdit ? (
          <EditableText value={frontText} onCommit={(t) => onEdit({ frontMarkdown: t, noteText: t })} />
        ) : (
          md(frontText)
        )}
        {dj && isListeningVocab && speakBtn}
      </div>
      <div className="review-back-a">
        {onEdit ? (
          <EditableText value={card.backMarkdown} onCommit={(t) => onEdit({ backMarkdown: t })} />
        ) : (
          md(card.backMarkdown)
        )}
        {/* v32（M7）：其余单词卡（中→外/外→中/挖空）发音按钮入答案字段 */}
        {dj && !isListeningVocab && speakBtn}
      </div>
    </>
  );
}

// ---------- Leech 六步处理向导（§8.7） ----------
export function LeechWizard({ card: cardProp, onClose, onDone }: { card: CardRecord; onClose: () => void; onDone: () => void }) {
  const T = useT();
  // D121：辨析弹窗可能改写卡面文字——向导后续的全行 update 必须基于最新行，否则会用旧文案覆盖
  const [freshCard, setFreshCard] = useState<CardRecord | null>(null);
  const card = freshCard ?? cardProp;
  const panelRef = useDialogA11y<HTMLDivElement>(onClose);
  const [step, setStep] = useState(0);
  const [diagnosis, setDiagnosis] = useState<{ diagnosis?: string; analysis?: string; suggestions?: string[] } | null>(null);
  const [running, setRunning] = useState(false);
  // v48.77（D121 §3.1）：辨析弹窗（与复习页共用 DisambiguateModal；替换 v30 易混对比卡一键生成）
  const [disambOpen, setDisambOpen] = useState(false);

  async function runDiagnose() {
    setRunning(true);
    try {
      const { cardGenerator } = await import("../lib/cards");
      const { aiGateway } = await import("../lib/ai");
      const tpl = await window.promptsAPI?.get("leech-rescue");
      const raw = await aiGateway.chat(
        [
          { role: "system", content: tpl?.content || "你是记忆难点诊断专家。" },
          {
            role: "user",
            content: `【卡面】\n${card.frontMarkdown || card.noteText}\n\n【答案】\n${card.backMarkdown}\n\n【遗忘次数】${card.fsrs?.lapses ?? 0}\n\n请诊断这张卡反复遗忘的原因，并给出处理建议。`
          }
        ],
        undefined,
        0.4
      );
      let parsed: { diagnosis?: string; analysis?: string; suggestions?: string[] } | null = null;
      try {
        const m = raw.match(/\{[\s\S]*\}/);
        if (m) parsed = JSON.parse(m[0]);
      } catch {
        /* 保留 null，用原文兜底 */
      }
      setDiagnosis(parsed || { analysis: raw });
    } catch (err) {
      setDiagnosis({ analysis: err instanceof Error ? err.message : String(err) });
    } finally {
      setRunning(false);
    }
  }

  const steps = [T("诊断"), T("补卡"), T("问法"), T("取舍"), T("暂缓"), T("助记")];
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" ref={panelRef} role="dialog" aria-modal="true" aria-label={T("记忆难点六步处理")} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{T("记忆难点 · 六步处理")}</h2>
          <button className="icon-btn modal-close" title={T("关闭")} onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
        <div className="modal-scroll">
          <div className="seg-tabs mb-4">
            {steps.map((s, i) => (
              <button key={s} className={step === i ? "active" : ""} onClick={() => setStep(i)}>
                {s}
              </button>
            ))}
          </div>

          <div className="queue-row mb-4">
            <div className="queue-row-text">{card.frontMarkdown || card.noteText}</div>
            <div className="queue-row-text review-back">{card.backMarkdown}</div>
          </div>

          {/* D121 §3.1：辨析（选另一张卡并排对照，可 AI 诊断、就地修正、归档或生成对比卡） */}
          <div className="ai-actions mb-4">
            <button className="btn btn-outline btn-sm" data-testid="leech-disamb-btn" onClick={() => setDisambOpen(true)}>{T("辨析")}</button>
          </div>

          {step === 0 && (
            <div>
              <p className="form-hint">{T("Step 1 · 明显原因？用 AI 诊断遗忘原因（歧义/干扰/缺前置/过载/是否题残留）。")}</p>
              <button className="btn btn-primary btn-sm" disabled={running} onClick={runDiagnose}>
                {running ? T("诊断中…") : T("AI 诊断")}
              </button>
              {diagnosis && (
                <div className="review-mnemonic mt-3">
                  <span className="book-card-label">{T("诊断")}</span>
                  {diagnosis.diagnosis || diagnosis.analysis}
                  {diagnosis.suggestions && diagnosis.suggestions.length > 0 && (
                    <ul className="plain-list">
                      {diagnosis.suggestions.map((s, i) => <li key={i}>{s}</li>)}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
          {step === 1 && (
            <div>
              <p className="form-hint">{T("Step 2 · 补充卡片。对卡内不熟的术语补前置知识卡；若存在相似卡，点「辨析」比较并修正。")}</p>
            </div>
          )}
          {step === 2 && (
            <div>
              <p className="form-hint">{T("Step 3 · 考察点不对？在阅读器重新选中文本，用「AI 制卡」换一种问法，然后删除或降优先这张卡。")}</p>
            </div>
          )}
          {step === 3 && (
            <div>
              <p className="form-hint">{T("Step 4 · 不重要？放弃最难的 10% 可换取约 3 倍学习吞吐——删除是理性决策不是失败。")}</p>
              <div className="settings-row">
                <button
                  className="btn btn-outline btn-sm"
                  onClick={async () => {
                    await cardsApi.remove(card.id);
                    onDone();
                  }}
                >
                  {T("删除这张卡")}
                </button>
                <button
                  className="btn btn-outline btn-sm"
                  onClick={async () => {
                    await cardsApi.update({ ...card, priority: 20 });
                    onDone();
                  }}
                >
                  {T("降优先级到 20")}
                </button>
              </div>
            </div>
          )}
          {step === 4 && (
            <div>
              <p className="form-hint">{T("Step 5 · 暂缓？推迟到指定日期自动恢复（备考冲刺期先搁置）。")}</p>
              <button
                className="btn btn-outline btn-sm"
                onClick={async () => {
                  await cardsApi.update({ ...card, fsrs: { ...card.fsrs, due: Date.now() + 30 * 86400000 } });
                  await cardsApi.updateLeech(card.id, { suspended: true, suspendedAt: Date.now() });
                  onDone();
                }}
              >
                {T("推迟 30 天并暂停")}
              </button>
            </div>
          )}
          {step === 5 && (
            <div>
              <p className="form-hint">{T("Step 6 · 助记。在阅读器选中卡面关键词用「AI 解释」，把助记方法填入卡片（编辑后重置为新卡）。")}</p>
            </div>
          )}

          <div className="settings-row mt-4">
            <button
              className="btn btn-secondary btn-sm"
              onClick={async () => {
                // 处理完成：重置为新卡 + 清 leech 标记（§8.7 处理后默认重置）
                await cardsApi.update({ ...card, fsrs: { state: "new", due: Date.now(), lapses: 0 } });
                await cardsApi.resolveLeech(card.id, "reworded", {});
                onDone();
              }}
            >
              {T("处理完成 · 重置为新卡")}
            </button>
            <button
              className="btn btn-outline btn-sm"
              onClick={async () => {
                await cardsApi.setSuspended(card.id, false);
                await cardsApi.resolveLeech(card.id, "resumed", {});
                onDone();
              }}
            >
              {T("仅恢复（不重置）")}
            </button>
          </div>
        </div>
      </div>
      {disambOpen && (
        <DisambiguateModal
          card={card}
          origin="browser"
          onClose={(r) => {
            setDisambOpen(false);
            if (r.archivedIds.includes(card.id)) {
              onDone();
              return;
            }
            if (r.changed) void cardsApi.get(card.id).then((fresh) => { if (fresh) setFreshCard(fresh); });
          }}
        />
      )}
    </div>
  );
}
