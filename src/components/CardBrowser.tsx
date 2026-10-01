// 卡片浏览界面（v19 Anki 式改造）：全量卡片表格 + 搜索/类型/状态筛选 + 排序 + 行详情维护。
// 浏览器式操作（对齐 Anki 浏览器，基于本库数据）：卡面预览与内联编辑（复用复习页 CardFace/EditableText）、
// 暂停/恢复、推迟、重置为新卡、删除、跳转原文、质检问题（CardIssue）查看、Leech 六步向导入口。
// 评分调度仍在连续刷题界面（ReviewView），此处不写复习日志。
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { parseCloze, extractClozeAnswers, cardsApi, hasSourceAnchor, type CardRecord, type CardIssueRecord, type TodayQueue } from "../lib/cards";
import { playVocabAudio } from "../lib/dictClient";
import { eventBus } from "../lib/eventbus";
import ContrastCardModal from "./ContrastCardModal";
import Dropdown from "./Dropdown";
import OcclusionShapes from "./OcclusionShapes";
import ImageLightbox from "./ImageLightbox";
import { IconVolume } from "./icons";
import { useDialogA11y } from "../lib/dialogA11y";
import KnowledgeManager from "./KnowledgeManager";
// v48.22（D58 §6.8-6）：浏览器 2.0——摘录行数据源 + 状态/推送文案
import { readingWorkflow, type DueTopic } from "../lib/readingWorkflow";
import { extractStatusLabel } from "../lib/sessionQueue";
import { nextAtText } from "./ExtractCardFace";
import { settingsStore } from "../lib/settings";
import { parseCardQuery, extractMatches, textMatches } from "../lib/cardQuery";

/** v48.22（D58 §6.8-5）：筛选牌组（复习范围）——保存的过滤条件，零 schema 变更 */
interface SavedScope {
  id: string;
  name: string;
  bookItemIds: string[];
  kinds: string[];
  limits?: unknown;
}

type Preset = "all" | "due" | "leech" | "deferred" | "knowledge";
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
const typeLabel = (t: string) => TYPE_LABELS[t] || t;

const STATE_LABELS: Record<string, string> = { new: "新卡", learning: "学习中", relearning: "学习中", review: "复习中" };

function statusOf(c: CardRecord): string {
  if (c.leech?.suspended) return "已暂停";
  return STATE_LABELS[c.fsrs?.state ?? "new"] ?? "复习中";
}

// 到期判定与 db.js listDueCards 同口径：未挂起且 due≤now（fsrs 缺失视为 due=now）
function isDueCard(c: CardRecord): boolean {
  if (c.leech?.suspended) return false;
  return (c.fsrs?.due ?? Date.now()) <= Date.now();
}

// 难点页签口径与 db.js listLeechCards 同口径：isLeech 或已暂停
function isLeechOrSuspended(c: CardRecord): boolean {
  return Boolean(c.leech?.isLeech || c.leech?.suspended);
}

function formatDue(ms: number): string {
  const days = ms / 86400000;
  if (days < 1 / 24) return `${Math.max(1, Math.round(ms / 60000))} 分钟`;
  if (days < 1) return `${Math.round(days * 24)} 小时`;
  if (days < 30) return `${Math.round(days)} 天`;
  if (days < 365) return `${(days / 30).toFixed(1)} 个月`;
  return `${(days / 365).toFixed(1)} 年`;
}

function dueText(c: CardRecord): string {
  if (c.leech?.suspended) return "—";
  const due = c.fsrs?.due;
  if (!due) return "—";
  const diff = due - Date.now();
  return diff <= 0 ? "已到期" : formatDue(diff);
}

// 浏览列表显示完整原文（挖空内容可见，Anki 浏览器同语义）；图片挖空带标记前缀
function frontPreview(c: CardRecord): string {
  const text = c.frontMarkdown || c.noteText;
  if (c.cardType === "imageOcclusion") return `[图片遮挡] ${text}`;
  if (c.cardType === "cloze") return parseCloze(text).render(null);
  return text;
}

// 来源展示：书名可能自带《》（导入时保留原书名），已带则不再包一层
// 与主进程 electron/db.js 的 foldSearch **逐字一致**（渲染层与主进程无法共享模块，
// 靠 F79「两条检索路径命中集必须相同」这条闸门守着）。D-TEST-84：原来这里是
// query.trim().toLowerCase()，少了 NFKC 这一步，于是同一个词在卡片浏览与日记/知识点给出不同结果。
const foldSearch = (s: unknown) => String(s ?? "").normalize("NFKC").trim().toLowerCase();

function srcLabel(c: CardRecord & { docTitle?: string }): string {
  const t = c.docTitle || c.sourceRef?.title || "";
  if (!t) return "—";
  return t.startsWith("《") ? t : `《${t}》`;
}

export default function CardBrowser({
  onJumpToDoc,
  onStartSession
}: {
  onJumpToDoc?: JumpToDoc;
  /** v48.22（D58 §6.8-5）：从筛选牌组进入「集中复习」（按范围开会话；App 负责路由） */
  onStartSession?: (scope: { bookItemIds: string[]; kinds: string[]; name: string; limits?: Record<string, number> | null }) => void;
}) {
  const [all, setAll] = useState<BrowserCard[]>([]);
  const [preset, setPreset] = useState<Preset>("all");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [stateFilter, setStateFilter] = useState("all");
  // v46（M14-UM2，§6.7.3）：「记忆接地」筛选（情境来自记忆的卡，含存疑）
  const [memFilter, setMemFilter] = useState(false);
  const [sortBy, setSortBy] = useState("due");
  const [detailId, setDetailId] = useState<string | null>(null);
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
  // v48.22（D58 §6.8-5）：筛选牌组（复习范围）——存 settings.app.reviewScopes，零 schema 变更（D51 先例）
  const [scopes, setScopes] = useState<SavedScope[]>([]);
  const [deckName, setDeckName] = useState("");
  // 上限覆写（§6.8-5：范围只能收紧、不能另开预算；0 = 继承全局）
  const [deckCapExtracts, setDeckCapExtracts] = useState(0);
  const [deckCapNewCards, setDeckCapNewCards] = useState(0);
  // v48.22（D58 §6.8-6 / O-8 裁定）：摘录正文查找替换（仅选中项、仅正文、纯文本，不做正则）
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");

  const refresh = useCallback(async () => {
    setAll(await cardsApi.listAll());
    try {
      setExtracts((await readingWorkflow.getAllTopics()) as DueTopic[]);
    } catch {
      setExtracts([]);
    }
    try {
      const saved = await settingsStore.get<SavedScope[]>("app", "reviewScopes", []);
      setScopes(Array.isArray(saved) ? saved.filter((s) => s && typeof s.id === "string") : []);
    } catch {
      setScopes([]);
    }
    try {
      const q = await cardsApi.todayQueue();
      setDeferredMap(new Map((q.deferred ?? []).map((c) => [c.id, c.deferReason ?? { siblingKey: c.siblingKey || "", kind: "revealed" as const, siblingCardId: null, siblingFront: "" }])));
    } catch {
      setDeferredMap(new Map());
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    refresh();
    return eventBus.on("cards/changed", refresh);
  }, [refresh]);

  const counts = useMemo(
    () => ({
      due: all.filter(isDueCard).length,
      leech: all.filter(isLeechOrSuspended).length,
      suspended: all.filter((c) => c.leech?.suspended).length,
      deferred: all.filter((c) => deferredMap.has(c.id)).length
    }),
    [all, deferredMap]
  );

  // 类型筛选项从库内实际存在的类型动态生成（未知类型显示原文）
  const typeOptions = useMemo(() => {
    const present = new Map<string, string>();
    for (const c of all) present.set(c.cardType, typeLabel(c.cardType));
    return [
      { value: "all", label: "全部类型" },
      ...[...present.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }))
    ];
  }, [all]);

  const filtered = useMemo(() => {
    const q = foldSearch(query);
    const parsed = parseCardQuery(query);
    let list = all;
    if (preset === "due") list = list.filter(isDueCard);
    if (preset === "leech") list = list.filter(isLeechOrSuspended);
    if (preset === "deferred") list = list.filter((c) => deferredMap.has(c.id));
    if (typeFilter !== "all") list = list.filter((c) => c.cardType === typeFilter);
    if (memFilter) list = list.filter((c) => !!c.memoryRefJson);
    if (stateFilter !== "all") {
      list = list.filter((c) => {
        if (stateFilter === "suspended") return Boolean(c.leech?.suspended);
        if (c.leech?.suspended) return false;
        const s = c.fsrs?.state ?? "new";
        return stateFilter === "learning" ? s === "learning" || s === "relearning" : s === stateFilter;
      });
    }
    if (q) {
      list = list.filter((c) => {
        const hay = [
          c.frontMarkdown,
          c.backMarkdown,
          c.noteText,
          c.contextPrefix || "",
          c.docTitle || "",
          ...(c.domain ?? []),
          ...(c.tags ?? [])
        ]
          .join("\n")
          .normalize("NFKC")
          .toLowerCase();
        // v48.22（D58 §6.8-6）：查询语法——主串 + 负号排除（字段前缀由下面的独立过滤处理）
        if (!hay.includes(q)) return false;
        return textMatches({ ...parsed, text: "" }, hay);
      });
    }
    // 查询语法里的字段前缀（kind/book/status/priority）——与下拉筛选叠加生效
    if (parsed.kind === "extract") list = [];
    if (parsed.book) {
      const bk = foldSearch(parsed.book);
      list = list.filter((c) => foldSearch(String(c.docTitle || "")).includes(bk));
    }
    if (parsed.status) {
      list = list.filter((c) => {
        const suspended = Boolean(c.leech?.suspended);
        const s = suspended ? "suspended" : c.fsrs?.state ?? "new";
        return String(s).toLowerCase() === parsed.status;
      });
    }
    if (parsed.priority || parsed.priorityNot !== undefined) {
      list = list.filter((c) => {
        const p = Number(c.priority) || 0;
        if (parsed.priorityNot !== undefined && p === parsed.priorityNot) return false;
        if (!parsed.priority) return true;
        const { op, value } = parsed.priority;
        if (op === "<=") return p <= value;
        if (op === ">=") return p >= value;
        if (op === "<") return p < value;
        if (op === ">") return p > value;
        return p === value;
      });
    }
    const sorted = [...list];
    if (sortBy === "created") sorted.sort((a, b) => b.createdAt - a.createdAt);
    else if (sortBy === "priority") sorted.sort((a, b) => b.priority - a.priority);
    else if (sortBy === "lapses") sorted.sort((a, b) => (b.fsrs?.lapses ?? 0) - (a.fsrs?.lapses ?? 0));
    else sorted.sort((a, b) => (a.fsrs?.due ?? 0) - (b.fsrs?.due ?? 0)); // 默认到期升序，同复习队列
    return sorted;
  }, [all, preset, typeFilter, stateFilter, memFilter, query, sortBy, deferredMap]);

  // ---- v48.22（D58 §6.8-6）：按书分组 + 多选 + 批量（唯一数据源＝cardsApi.listAll + workflowAPI.listAll）
  const bookOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of all) {
      const id = (c as { libraryItemId?: string | null }).libraryItemId;
      if (id) m.set(String(id), String((c as { docTitle?: string }).docTitle || "未知材料"));
    }
    for (const e of extracts) if (e.libraryItemId) m.set(String(e.libraryItemId), String(e.docTitle || "未知材料"));
    return [{ value: "all", label: "全部来源书" }, ...[...m.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }))];
  }, [all, extracts]);

  const scopeCards = useMemo(
    () => (bookScope === "all" ? filtered : filtered.filter((c) => String((c as { libraryItemId?: string | null }).libraryItemId || "") === bookScope)),
    [filtered, bookScope]
  );

  const scopeExtracts = useMemo(() => {
    const q = foldSearch(query);
    const parsed = parseCardQuery(query);
    if (parsed.kind === "card") return [];
    let list = extracts;
    if (bookScope !== "all") list = list.filter((e) => String(e.libraryItemId || "") === bookScope);
    if (parsed.book) {
      const bk = foldSearch(parsed.book);
      list = list.filter((e) => foldSearch(String(e.docTitle || "")).includes(bk));
    }
    if (q || parsed.exclude.length || parsed.status || parsed.priority || parsed.priorityNot !== undefined) {
      list = list.filter((e) => {
        if (!extractMatches(parsed, e)) return false;
        const p = Number(e.priority) || 0;
        if (parsed.priorityNot !== undefined && p === parsed.priorityNot) return false;
        if (parsed.priority) {
          const { op, value } = parsed.priority;
          if (op === "<=" && !(p <= value)) return false;
          if (op === ">=" && !(p >= value)) return false;
          if (op === "<" && !(p < value)) return false;
          if (op === ">" && !(p > value)) return false;
          if (op === "=" && p !== value) return false;
        }
        return true;
      });
    }
    if (preset === "due") list = list.filter((e) => Number(e.topicNextAt) <= Date.now());
    return list;
  }, [extracts, bookScope, query, preset]);

  const viewCards = kindFilter === "extract" ? [] : scopeCards;
  const viewExtracts = kindFilter === "card" ? [] : scopeExtracts;

  interface MouseMod {
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
  }
  function toggleSel(kind: "card" | "extract", id: string, e: MouseMod) {
    const set = kind === "card" ? selCards : selExtracts;
    const ids = (kind === "card" ? scopeCards.map((c) => c.id) : scopeExtracts.map((x) => x.id));
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
  function selectAllOf(kind: "card" | "extract") {
    if (kind === "card") setSelCards(new Set(scopeCards.map((c) => c.id)));
    else setSelExtracts(new Set(scopeExtracts.map((e) => e.id)));
  }
  function invertOf(kind: "card" | "extract") {
    if (kind === "card") setSelCards(new Set(scopeCards.filter((c) => !selCards.has(c.id)).map((c) => c.id)));
    else setSelExtracts(new Set(scopeExtracts.filter((e) => !selExtracts.has(e.id)).map((e) => e.id)));
  }
  function flashNote(text: string) {
    setBatchNote(text);
    window.setTimeout(() => setBatchNote(null), 2400);
  }
  async function runCardBatch(op: string, payload?: unknown) {
    const ids = [...selCards];
    if (ids.length === 0) return;
    if (op === "delete" && !window.confirm(`删除选中的 ${ids.length} 张卡？（软删，可在备份中找回）`)) return;
    setBatchBusy(true);
    try {
      const r = await cardsApi.batch(op, ids, payload);
      if (r?.ok) {
        setSelCards(new Set());
        flashNote(`已处理 ${r.count ?? ids.length} 张卡`);
        eventBus.emit("cards/changed");
        await refresh();
      } else {
        flashNote(r?.reason || "批量操作失败，整批未执行");
      }
    } finally {
      setBatchBusy(false);
    }
  }
  async function runExtractBatch(op: string, payload?: unknown) {
    const ids = [...selExtracts];
    if (ids.length === 0) return;
    if (op === "delete" && !window.confirm(`删除选中的 ${ids.length} 条摘录？（软删，可在备份中找回）`)) return;
    setBatchBusy(true);
    try {
      const r = (await readingWorkflow.batch(op as never, ids, payload as never)) as { ok?: boolean; count?: number; skipped?: Array<{ reason: string }>; reason?: string };
      if (r?.ok) {
        setSelExtracts(new Set());
        const skipped = Array.isArray(r.skipped) && r.skipped.length ? `（${r.skipped.length} 条按规则跳过）` : "";
        flashNote(`已处理 ${r.count ?? ids.length} 条摘录${skipped}`);
        await refresh();
      } else {
        flashNote(r?.reason || "批量操作失败，整批未执行");
      }
    } finally {
      setBatchBusy(false);
    }
  }

  // v48.22（D58 §6.8-5）：筛选牌组——保存当前筛选为复习范围 / 应用 / 集中复习 / 删除
  async function saveDeck() {
    const fallback = kindFilter === "card" ? "闪卡" : kindFilter === "extract" ? "摘录" : "全部";
    const name = deckName.trim() || `筛选牌组 · ${fallback}`;
    const scope: SavedScope = {
      id: crypto.randomUUID(),
      name,
      bookItemIds: bookScope === "all" ? [] : [bookScope],
      kinds: kindFilter === "both" ? ["card", "extract"] : [kindFilter],
      limits: deckCapExtracts > 0 || deckCapNewCards > 0
        ? { ...(deckCapExtracts > 0 ? { extractReviewsPerDay: deckCapExtracts } : {}), ...(deckCapNewCards > 0 ? { newCardsPerDay: deckCapNewCards } : {}) }
        : null
    };
    const next = [...scopes, scope];
    await settingsStore.set("app", "reviewScopes", next);
    setScopes(next);
    setDeckName("");
    flashNote(`已保存筛选牌组「${name}」`);
  }
  function applyDeck(scope: SavedScope) {
    setKindFilter(scope.kinds.length === 2 ? "both" : scope.kinds[0] === "extract" ? "extract" : "card");
    setBookScope(scope.bookItemIds[0] || "all");
    flashNote(`已应用「${scope.name}」`);
  }
  async function deleteDeck(id: string) {
    const next = scopes.filter((s) => s.id !== id);
    await settingsStore.set("app", "reviewScopes", next);
    setScopes(next);
  }

  /** 查找替换（O-8：仅选中项、仅正文、纯文本；逐条落 edit 操作日志，撤销按次回退） */
  async function runFindReplace() {
    const needle = findText;
    if (!needle) {
      flashNote("请先填写要查找的文字");
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
      flashNote(changed > 0 ? `已替换 ${changed} 条摘录的正文` : "选中的摘录里没有该文字");
      await refresh();
    } finally {
      setBatchBusy(false);
    }
  }

  // v48.22（D58 §6.8-6）：行数窗口——真实库可达上万行，全量渲染会让筛选/滚动卡顿；
  // 先渲染 200 行 + 「显示更多」增量放行（真正的虚拟滚动留待后续批次，此处是可用性下限保障）
  const [rowLimit, setRowLimit] = useState(200);
  useEffect(() => {
    setRowLimit(200);
  }, [query, typeFilter, stateFilter, preset, kindFilter, bookScope, memFilter, sortBy]);

  // 查询语法里的 `kind:` 直接切类别页签（否则「搜了 kind:extract 却什么都不显示」）
  useEffect(() => {
    const parsed = parseCardQuery(query);
    if (parsed.kind) setKindFilter(parsed.kind);
  }, [query]);

  const detail = detailId ? all.find((c) => c.id === detailId) ?? null : null;

  return (
    <div className="queue-wrap">
      <div className="review-count mono">
        共 {all.length} 张 · 到期 {counts.due} · 难点 {counts.leech} · 暂停 {counts.suspended}
      </div>

      <div className="seg-tabs seg-tabs-pad">
        <button className={preset === "all" ? "active" : ""} onClick={() => setPreset("all")}>
          全部卡片
        </button>
        <button className={preset === "due" ? "active" : ""} onClick={() => setPreset("due")}>
          到期卡片 ({counts.due})
        </button>
        <button className={preset === "leech" ? "active" : ""} onClick={() => setPreset("leech")}>
          记忆难点 ({counts.leech})
        </button>
        {/* v34（M12，§4.16）：今日同源暂缓——被同源卡延后到明日的卡（点开行详情可见原因） */}
        {counts.deferred > 0 && (
          <button className={preset === "deferred" ? "active" : ""} onClick={() => setPreset("deferred")}>
            今日暂缓 ({counts.deferred})
          </button>
        )}
        {/* v40（K1，D37）：知识地基管理面（§9.1 K1-4 最小管理页） */}
        <button className={preset === "knowledge" ? "active" : ""} onClick={() => setPreset("knowledge")}>
          知识点
        </button>
      </div>

      {preset === "knowledge" && <KnowledgeManager />}

      {preset !== "knowledge" && (
      <>
      <div className="cb-toolbar">
        <input
          className="cb-search"
          placeholder='搜索题面、答案、前缀、来源、领域、标签…（支持 -排除、kind:、book:、status:、priority<=30）'
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Dropdown title="按卡片类型筛选" value={typeFilter} options={typeOptions} onChange={setTypeFilter} />
        <Dropdown
          title="按复习状态筛选"
          value={stateFilter}
          options={[
            { value: "all", label: "全部状态" },
            { value: "new", label: "新卡" },
            { value: "learning", label: "学习中" },
            { value: "review", label: "复习中" },
            { value: "suspended", label: "已暂停" }
          ]}
          onChange={setStateFilter}
        />
        <Dropdown
          title="排序方式"
          value={sortBy}
          options={[
            { value: "due", label: "按到期时间" },
            { value: "created", label: "按创建时间" },
            { value: "priority", label: "按优先级" },
            { value: "lapses", label: "按遗忘次数" }
          ]}
          onChange={setSortBy}
        />
        {/* v46（M14-UM2，§6.7.3）：记忆接地筛选——情境来自记忆的卡（含「来源存疑」） */}
        <button
          className={`btn btn-sm ${memFilter ? "btn-primary" : "btn-outline"}`}
          title="只显示情境来自用户记忆的卡片"
          onClick={() => setMemFilter((v) => !v)}
        >
          记忆接地
        </button>
        {/* v48.22（D58 §6.8-6）：类别切换（闪卡 / 摘录 / 全部） + 按来源书筛选 */}
        <div className="seg-tabs seg-tabs-sm" role="group" aria-label="条目类别">
          <button className={kindFilter === "card" ? "active" : ""} data-kind-card onClick={() => setKindFilter("card")}>
            闪卡
          </button>
          <button className={kindFilter === "extract" ? "active" : ""} data-kind-extract onClick={() => setKindFilter("extract")}>
            摘录
          </button>
          <button className={kindFilter === "both" ? "active" : ""} data-kind-both onClick={() => setKindFilter("both")}>
            全部
          </button>
        </div>
        <Dropdown title="按来源书筛选" value={bookScope} options={bookOptions} onChange={setBookScope} />
      </div>

      {/* v48.22（D58 §6.8-6）：多选与批量动作条（选择态常驻，动作在选中 ≥1 条时出现） */}
      <div className="cb-batch" data-batch-bar>
        {kindFilter !== "extract" && (
          <>
            <button className="btn btn-outline btn-sm" data-sel-all-cards onClick={() => selectAllOf("card")}>
              全选闪卡
            </button>
            <button className="btn btn-outline btn-sm" onClick={() => invertOf("card")}>
              反选闪卡
            </button>
          </>
        )}
        {kindFilter !== "card" && (
          <>
            <button className="btn btn-outline btn-sm" data-sel-all-extracts onClick={() => selectAllOf("extract")}>
              全选摘录
            </button>
            <button className="btn btn-outline btn-sm" onClick={() => invertOf("extract")}>
              反选摘录
            </button>
          </>
        )}
        {selCards.size + selExtracts.size > 0 && (
          <>
            <span className="mono" data-sel-count>
              已选 闪卡 {selCards.size} · 摘录 {selExtracts.size}
            </span>
            {selCards.size > 0 && (
              <>
                <button className="btn btn-outline btn-sm" disabled={batchBusy} onClick={() => void runCardBatch("suspend")}>批量暂停</button>
                <button className="btn btn-outline btn-sm" disabled={batchBusy} onClick={() => void runCardBatch("resume")}>批量恢复</button>
                <button className="btn btn-outline btn-sm" disabled={batchBusy} data-batch-postpone-cards onClick={() => void runCardBatch("postpone", { days: 7 })}>推迟 7 天</button>
                <button className="btn btn-outline btn-sm" disabled={batchBusy} data-batch-delete-cards onClick={() => void runCardBatch("delete")}>删除</button>
              </>
            )}
            {selExtracts.size > 0 && (
              <>
                <button className="btn btn-outline btn-sm" disabled={batchBusy} data-batch-postpone-extracts onClick={() => void runExtractBatch("postponeDays", { days: 7 })}>推迟 7 天</button>
                <button className="btn btn-outline btn-sm" disabled={batchBusy} onClick={() => void runExtractBatch("set_priority", { priority: 30 })}>优先级 30</button>
                <button className="btn btn-outline btn-sm" disabled={batchBusy} onClick={() => void runExtractBatch("set_priority", { priority: 70 })}>优先级 70</button>
                <button className="btn btn-outline btn-sm" disabled={batchBusy} data-batch-graduate onClick={() => void runExtractBatch("set_status", { status: "resolved" })}>毕业</button>
                <button className="btn btn-outline btn-sm" disabled={batchBusy} onClick={() => void runExtractBatch("set_status", { status: "open" })}>召回</button>
                {/* v48.22（D58 §6.4.2）：状态机另两个出口——归档（留痕）/ 不再关心（可召回） */}
                <button className="btn btn-outline btn-sm" disabled={batchBusy} data-batch-archive onClick={() => void runExtractBatch("set_status", { status: "archived" })}>归档</button>
                <button className="btn btn-outline btn-sm" disabled={batchBusy} onClick={() => void runExtractBatch("set_status", { status: "dismissed" })}>不再关心</button>
                <button className="btn btn-outline btn-sm" disabled={batchBusy} data-batch-delete-extracts onClick={() => void runExtractBatch("delete")}>删除</button>
                <input className="cb-search cb-find" data-find-input placeholder="查找" value={findText} onChange={(e) => setFindText(e.target.value)} />
                <input className="cb-search cb-find" data-replace-input placeholder="替换为" value={replaceText} onChange={(e) => setReplaceText(e.target.value)} />
                <button className="btn btn-outline btn-sm" disabled={batchBusy} data-find-replace onClick={() => void runFindReplace()}>正文查找替换</button>
              </>
            )}
            <button
              className="btn btn-outline btn-sm"
              onClick={() => {
                setSelCards(new Set());
                setSelExtracts(new Set());
              }}
            >
              清除选择
            </button>
          </>
        )}
        {batchNote && <span className="form-hint" data-batch-note>{batchNote}</span>}
      </div>

      {/* v48.22（D58 §6.8-5）：筛选牌组＝保存下来的复习范围（不移动卡片，故复习记录照常入 FSRS） */}
      <div className="cb-batch" data-deck-bar>
        <span className="mono">筛选牌组</span>
        <input
          className="cb-search cb-deck-name"
          data-deck-name
          placeholder="牌组名称（可留空自动命名）"
          value={deckName}
          onChange={(e) => setDeckName(e.target.value)}
        />
        <button className="btn btn-outline btn-sm" data-deck-save onClick={() => void saveDeck()}>
          保存当前筛选
        </button>
        <span className="mono">上限覆写</span>
        <input
          className="mono input-num"
          data-deck-cap-extracts
          type="number"
          min={0}
          max={9999}
          title="该范围的摘录处理上限（0=继承全局；只能收紧）"
          value={deckCapExtracts}
          onChange={(e) => setDeckCapExtracts(Math.max(0, Math.min(9999, Number(e.target.value) || 0)))}
        />
        <span className="form-hint">摘录/日</span>
        <input
          className="mono input-num"
          data-deck-cap-newcards
          type="number"
          min={0}
          max={9999}
          title="该范围的新卡上限（0=继承全局；只能收紧）"
          value={deckCapNewCards}
          onChange={(e) => setDeckCapNewCards(Math.max(0, Math.min(9999, Number(e.target.value) || 0)))}
        />
        <span className="form-hint">新卡/日</span>
        {scopes.map((s) => (
          <span className="cb-deck" data-deck-item key={s.id}>
            <button className="btn btn-outline btn-sm" data-deck-apply title="把浏览器的筛选切到该范围" onClick={() => applyDeck(s)}>
              {s.name}
              <span className="n"> {s.kinds.join("/")}{s.bookItemIds.length ? " · 单书" : ""}</span>
            </button>
            {onStartSession && (
              <button
                className="btn btn-outline btn-sm"
                data-deck-start
                title="按该范围开始集中复习（记录照常计入 FSRS）"
                onClick={() => onStartSession({ bookItemIds: s.bookItemIds, kinds: s.kinds, name: s.name, limits: (s.limits as Record<string, number> | null) ?? null })}
              >
                集中复习
              </button>
            )}
            <button className="btn btn-outline btn-sm" data-deck-delete onClick={() => void deleteDeck(s.id)}>
              删除
            </button>
          </span>
        ))}
        {scopes.length === 0 && <span className="form-hint">把当前「类别 + 来源书」筛选存下来，即可反复进入同一复习范围。</span>}
      </div>

      {loaded && viewCards.length === 0 && viewExtracts.length === 0 && (
        <div className="empty-state">
          <div className="empty-deco">
            <span className="empty-sq empty-sq-accent" />
            <span className="empty-sq" />
            <span className="empty-sq" />
          </div>
          <p className="empty-text">
            {all.length === 0 ? "还没有卡片。在阅读器中选中文字即可制卡。" : "没有符合筛选条件的卡片。"}
          </p>
        </div>
      )}

      {preset === "leech" ? (
        <div className="queue-list">
          {filtered.map((c) => (
            <div key={c.id} className="queue-row" onClick={() => setDetailId(c.id)}>
              <div className="queue-row-head">
                <span>
                  {c.leech?.suspended ? "已暂停" : "处理中"} · 遗忘 {c.fsrs?.lapses ?? 0} 次
                  {c.docTitle ? ` · 来自 ${srcLabel(c)}` : ""}
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
                  六步处理
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="cb-table" role="table">
          <div className="cb-row cb-row-head" role="row">
            <span className="cb-pick">选</span>
            <span>题面</span>
            <span>类型</span>
            <span>状态</span>
            <span>到期</span>
            <span className="cb-num">复习</span>
            <span className="cb-num">遗忘</span>
            <span className="cb-num">优先</span>
            <span>来源</span>
          </div>
          {viewCards.slice(0, rowLimit).map((c) => (
            <div
              key={c.id}
              className={`cb-row${selCards.has(c.id) ? " is-selected" : ""}`}
              role="row"
              onClick={(ev) => (ev.ctrlKey || ev.metaKey || ev.shiftKey ? toggleSel("card", c.id, ev) : setDetailId(c.id))}
              title="Ctrl/⌘ 点击多选 · Shift 点击范围选"
            >
              <span className="cb-pick">
                <input
                  type="checkbox"
                  checked={selCards.has(c.id)}
                  onClick={(ev) => ev.stopPropagation()}
                  onChange={() => toggleSel("card", c.id, { shiftKey: false, ctrlKey: false, metaKey: false })}
                />
              </span>
              <span className="cb-front" title={frontPreview(c)}>
                {frontPreview(c)}
              </span>
              <span>{typeLabel(c.cardType)}</span>
              <span>{statusOf(c)}{deferredMap.has(c.id) ? " · 同源暂缓" : ""}</span>
              <span className="mono">{dueText(c)}</span>
              <span className="cb-num mono">{c.fsrs?.reps ?? 0}</span>
              <span className="cb-num mono">{c.fsrs?.lapses ?? 0}</span>
              <span className="cb-num mono">{c.priority}</span>
              {/* D-TEST-80：来源列会被 CSS 单行裁切（theme.css .cb-src），却不带 title，
                  而同一行的题面列（上方 .cb-front）一直带着——实测 12033 行里 597 处全文不可达。
                  这里补上与题面同样的 title，让被省略号吃掉的尾部可以悬停读到。 */}
              <span className="cb-src" title={srcLabel(c)}>{srcLabel(c)}</span>
            </div>
          ))}
          {viewCards.length > rowLimit && (
            <div className="cb-row" role="row">
              <span className="cb-front">
                <button className="btn btn-outline btn-sm" data-more-rows onClick={() => setRowLimit((n) => n + 200)}>
                  显示更多（还有 {viewCards.length - rowLimit} 行）
                </button>
              </span>
            </div>
          )}
        </div>
      )}
      </>
      )}

      {/* v48.22（D58 §6.8-6）：摘录表——与闪卡同页管理（状态/优先级/下次推送/来源书） */}
      {kindFilter !== "card" && (
        <div className="cb-table" role="table" data-extract-table>
          <div className="cb-row cb-row-head" role="row">
            <span className="cb-pick">选</span>
            <span>摘录内容</span>
            <span>状态</span>
            <span className="cb-num">优先</span>
            <span>下次推送</span>
            <span>来源</span>
            <span>操作</span>
          </div>
          {viewExtracts.slice(0, rowLimit).map((e) => (
            <div
              key={e.id}
              className={`cb-row${selExtracts.has(e.id) ? " is-selected" : ""}`}
              role="row"
              onClick={(ev) => toggleSel("extract", e.id, ev)}
              title="点击选择 · Ctrl/⌘ 多选 · Shift 范围选（摘录行不展开详情，管理动作走批量条）"
            >
              <span className="cb-pick">
                <input
                  type="checkbox"
                  checked={selExtracts.has(e.id)}
                  onClick={(ev) => ev.stopPropagation()}
                  onChange={() => toggleSel("extract", e.id, { shiftKey: false, ctrlKey: false, metaKey: false })}
                />
              </span>
              <span className="cb-front" title={e.contentMarkdown}>
                {(e.contentMarkdown || "").slice(0, 90)}
              </span>
              <span>{extractStatusLabel(e.status)}</span>
              <span className="cb-num mono">
                {e.priority}
                {e.prioritySource === "user" ? " ·改" : ""}
              </span>
              <span className="mono">{nextAtText(e.topicNextAt)}</span>
              <span className="cb-src" title={e.docTitle}>
                {e.docTitle}
              </span>
              <span>
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
                    跳转原文
                  </button>
                ) : (
                  <span className="form-hint">—</span>
                )}
              </span>
            </div>
          ))}
          {viewExtracts.length > rowLimit && (
            <div className="cb-row" role="row">
              <span className="cb-front">
                <button className="btn btn-outline btn-sm" data-more-rows-extract onClick={() => setRowLimit((n) => n + 200)}>
                  显示更多（还有 {viewExtracts.length - rowLimit} 行）
                </button>
              </span>
            </div>
          )}
          {viewExtracts.length === 0 && (
            <div className="cb-row" role="row">
              <span className="cb-front">没有符合筛选条件的摘录。</span>
            </div>
          )}
        </div>
      )}

      {detail && (
        <CardDetail
          card={detail}
          deferredNote={
            (() => {
              const r = deferredMap.get(detail.id);
              if (!r) return undefined;
              const front = r.siblingFront ? `「${r.siblingFront.slice(0, 20)}${r.siblingFront.length > 20 ? "…" : ""}」` : "";
              return r.kind === "reviewed" ? `同源卡今日已评分：${front}，明日解封` : `与今日已放行的${front || "同源卡"}同源，明日解封`;
            })()
          }
          onClose={() => setDetailId(null)}
          onJumpToDoc={onJumpToDoc}
          onOpenLeech={(c) => setLeechTarget(c)}
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

// ---------- 行详情（v19：Anki 浏览器的卡片信息 + 维护动作） ----------
// 卡面预览复用复习页 CardFace（showBack + onEdit → EditableText 内联编辑，cloze 自动回填挖空语法）；
// 编辑只改文案不动 FSRS（updateCard 未传 fsrs 时保留原值，§7.2）。
function CardDetail({
  card,
  onClose,
  onJumpToDoc,
  onOpenLeech,
  deferredNote
}: {
  card: BrowserCard;
  onClose: () => void;
  onJumpToDoc?: JumpToDoc;
  onOpenLeech: (card: BrowserCard) => void;
  /** v34（M12）：今日同源暂缓原因（不在暂缓组时为 undefined） */
  deferredNote?: string;
}) {
  const panelRef = useDialogA11y<HTMLDivElement>(onClose);
  const [issues, setIssues] = useState<CardIssueRecord[]>([]);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    cardsApi.listIssues(card.id).then((list) => {
      if (!cancelled) setIssues(list.filter((i) => i.status === "open"));
    });
    return () => {
      cancelled = true;
    };
  }, [card.id, card.updatedAt]);

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
    if (!window.confirm("重置为新卡？该卡的调度进度（稳定度/难度/复习次数/遗忘次数）将被清零。")) return;
    await cardsApi.update({ ...card, fsrs: { state: "new", due: Date.now(), lapses: 0 } });
    eventBus.emit("cards/changed");
  }

  async function handleDelete() {
    if (!window.confirm(`确定删除这张卡片？\n\n${card.frontMarkdown || card.noteText}`)) return;
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

  const f = card.fsrs ?? {};
  const meta: [string, string][] = [
    ["类型", typeLabel(card.cardType)],
    ["状态", statusOf(card) + (deferredNote ? `（${deferredNote}）` : "")],
    ["到期", dueText(card)],
    ["复习 / 遗忘", `${f.reps ?? 0} 次 / ${f.lapses ?? 0} 次`],
    [
      "稳定度 / 难度",
      f.stability != null && f.difficulty != null ? `${f.stability.toFixed(2)} / ${f.difficulty.toFixed(2)}` : "—"
    ],
    ["优先级", `P${card.priority}`],
    ["来源", srcLabel(card)],
    ["领域", (card.domain ?? []).join("、") || "—"],
    // v40（K1）：legacy knowledge_point_id（正式 KP 之外的原值；归一提案见「知识点」页签）
    ["知识点", card.knowledgePointId || "—"],
    ["生成方式", card.generatedBy === "ai" ? "AI 生成" : "手动"],
    ["创建时间", new Date(card.createdAt).toLocaleString()]
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" ref={panelRef} role="dialog" aria-modal="true" aria-label="卡片详情" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>卡片详情</h2>
          <button className="icon-btn modal-close" title="关闭" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
        <div className="modal-scroll">
          <CardFace card={card} showBack onReveal={() => {}} onEdit={handleEdit} />

          {/* v46（M14-UM2，§6.7.3）：记忆溯源——显示所引记忆行与校验状态；已入库卡不随记忆文件改动自动改写 */}
          {card.memoryRefJson && (
            <div className="cb-issues">
              <span className={`lint ${card.memoryRefJson.verified ? "lint-info" : "lint-warn"}`}>
                {card.memoryRefJson.verified ? "情境来自记忆" : "情境来源存疑（来源可能已变更）"}
              </span>
              <div className="mono fs-meta mt-2">
                引用记忆行：{card.memoryRefJson.line}
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

          {issues.length > 0 && (
            <div className="cb-issues">
              <p className="cb-issues-title">质检问题（CardLint / 相似检索）</p>
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
                  跳转原文
                </button>
              ) : (
                <button className="btn btn-outline btn-sm" disabled title="该卡制卡时未记录原文位置（旧卡），无法跳转">
                  跳转原文
                </button>
              )
            )}
            {card.cardType === "imageOcclusion" && card.occlusionJson && (
              <button className="btn btn-outline btn-sm" onClick={() => setLightboxOpen(true)}>
                查看原图
              </button>
            )}
            <button className="btn btn-outline btn-sm" onClick={toggleSuspend}>
              {card.leech?.suspended ? "恢复调度" : "暂停调度"}
            </button>
            <button className="btn btn-outline btn-sm" onClick={() => postpone(1)}>
              推迟 1 天
            </button>
            <button className="btn btn-outline btn-sm" onClick={() => postpone(7)}>
              推迟 7 天
            </button>
            <button className="btn btn-outline btn-sm" onClick={resetNew}>
              重置为新卡
            </button>
            {card.leech?.isLeech && (
              <button className="btn btn-secondary btn-sm" onClick={() => onOpenLeech(card)}>
                六步处理
              </button>
            )}
            <button className="btn btn-outline btn-sm review-delete" onClick={handleDelete}>
              删除
            </button>
          </div>
          <p className="form-hint">题面与答案可直接点击编辑（失焦落库，挖空卡自动回填挖空语法）；复习评分请回到「复习」页。</p>
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
  const md = (s: string) => (
    <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{s}</ReactMarkdown>
  );

  const frontText = card.frontMarkdown || card.noteText;

  // v32（M7）单词卡发音按钮：听音卡嵌题面内、其余卡嵌答案区（dict_json.kind 分流；
  // 存量无 kind 卡按 front 前缀「发音：」判定）。stopPropagation 防触发翻面。
  const dj = card.dictJson;
  const isListeningVocab = !!dj && (dj.kind ? dj.kind === "listening" : frontText.startsWith("发音："));
  const speakBtn = dj ? (
    <button
      className="vocab-speak-btn"
      title="播放发音"
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
    return (
      <div className="review-face">
        <div className="occlusion-stage">
          <img src={card.occlusionJson.assetPath} alt="" className="occlusion-img" />
          <OcclusionShapes occlusion={card.occlusionJson} cardOrd={card.cardOrd} hidden={showBack} />
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
        {showBack && (
          <div className="review-back">
            {onEdit ? (
              <EditableText value={card.backMarkdown} onCommit={(t) => onEdit({ backMarkdown: t })} />
            ) : (
              card.backMarkdown
            )}
          </div>
        )}
        {!showBack && (
          <button className="btn btn-primary" onClick={onReveal}>显示答案</button>
        )}
      </div>
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
    const questionEditable = showBack && onEdit;
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
    return (
      <div className="review-face" onClick={!showBack && onReveal ? onReveal : undefined}>
        <div className="review-front">
          {card.contextPrefix && <span className="review-prefix mono">{card.contextPrefix}</span>}
          {questionEditable ? (
            <EditableText value={questionText} onCommit={commitQuestion} />
          ) : (
            md(questionText)
          )}
        </div>
        {showBack && (
          <div className="review-back">
            {onEdit ? (
              <EditableText value={clozeAnswer} onCommit={(t) => onEdit({ backMarkdown: t })} />
            ) : (
              clozeAnswer
            )}
            {/* v32（M7）：单词挖空卡（非听音）发音按钮入答案字段 */}
            {dj && !isListeningVocab && speakBtn}
          </div>
        )}
      </div>
    );
  }

  // v16（D18）：翻转问答卡 = 制卡手段，创建时即拆为两张独立 qa 卡；
  // 不存在复习期形态变化的卡片类型，一切卡设计以 FSRS 为核心。

  return (
    <div className="review-face" onClick={!showBack && onReveal ? onReveal : undefined}>
      <div className="review-front">
        {card.contextPrefix && <span className="review-prefix mono">{card.contextPrefix}</span>}
        {showBack && onEdit ? (
          <EditableText value={frontText} onCommit={(t) => onEdit({ frontMarkdown: t, noteText: t })} />
        ) : (
          md(frontText)
        )}
        {/* v32（M7）：听音卡发音按钮嵌入题面字段（存量无 kind 卡按 front 前缀「发音：」判定） */}
        {dj && isListeningVocab && speakBtn}
      </div>
      {showBack && (
        <div className="review-back">
          {onEdit ? (
            <EditableText value={card.backMarkdown} onCommit={(t) => onEdit({ backMarkdown: t })} />
          ) : (
            md(card.backMarkdown)
          )}
          {/* v32（M7）：其余单词卡（中→外/外→中/挖空）发音按钮入答案字段 */}
          {dj && !isListeningVocab && speakBtn}
        </div>
      )}
    </div>
  );
}

// ---------- Leech 六步处理向导（§8.7） ----------
export function LeechWizard({ card, onClose, onDone }: { card: CardRecord; onClose: () => void; onDone: () => void }) {
  const panelRef = useDialogA11y<HTMLDivElement>(onClose);
  const [step, setStep] = useState(0);
  const [diagnosis, setDiagnosis] = useState<{ diagnosis?: string; analysis?: string; suggestions?: string[] } | null>(null);
  const [running, setRunning] = useState(false);
  // v30（D29）：易混对比卡一键生成（与复习页共用 ContrastCardModal）
  const [contrastOpen, setContrastOpen] = useState(false);

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

  const steps = ["诊断", "补卡", "问法", "取舍", "暂缓", "助记"];
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" ref={panelRef} role="dialog" aria-modal="true" aria-label="记忆难点六步处理" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>记忆难点 · 六步处理</h2>
          <button className="icon-btn modal-close" title="关闭" onClick={onClose}>
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

          {/* v30（D29）：以本卡为基准生成易混对比卡三件套 */}
          <div className="ai-actions mb-4">
            <button className="btn btn-outline btn-sm" onClick={() => setContrastOpen(true)}>生成对比卡</button>
          </div>

          {step === 0 && (
            <div>
              <p className="form-hint">Step 1 · 明显原因？用 AI 诊断遗忘原因（歧义/干扰/缺前置/过载/是否题残留）。</p>
              <button className="btn btn-primary btn-sm" disabled={running} onClick={runDiagnose}>
                {running ? "诊断中…" : "AI 诊断"}
              </button>
              {diagnosis && (
                <div className="review-mnemonic mt-3">
                  <span className="book-card-label">诊断</span>
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
              <p className="form-hint">Step 2 · 补充卡片。对卡内不熟的术语补前置知识卡；若存在相似卡，生成对比卡区分（需在阅读器选中对应文字后用 AI 制卡）。</p>
            </div>
          )}
          {step === 2 && (
            <div>
              <p className="form-hint">Step 3 · 考察点不对？在阅读器重新选中文本，用「AI 制卡」换一种问法，然后删除或降优先这张卡。</p>
            </div>
          )}
          {step === 3 && (
            <div>
              <p className="form-hint">Step 4 · 不重要？放弃最难的 10% 可换取约 3 倍学习吞吐——删除是理性决策不是失败。</p>
              <div className="settings-row">
                <button
                  className="btn btn-outline btn-sm"
                  onClick={async () => {
                    await cardsApi.remove(card.id);
                    onDone();
                  }}
                >
                  删除这张卡
                </button>
                <button
                  className="btn btn-outline btn-sm"
                  onClick={async () => {
                    await cardsApi.update({ ...card, priority: 20 });
                    onDone();
                  }}
                >
                  降优先级到 20
                </button>
              </div>
            </div>
          )}
          {step === 4 && (
            <div>
              <p className="form-hint">Step 5 · 暂缓？推迟到指定日期自动恢复（备考冲刺期先搁置）。</p>
              <button
                className="btn btn-outline btn-sm"
                onClick={async () => {
                  await cardsApi.update({ ...card, fsrs: { ...card.fsrs, due: Date.now() + 30 * 86400000 } });
                  await cardsApi.updateLeech(card.id, { suspended: true, suspendedAt: Date.now() });
                  onDone();
                }}
              >
                推迟 30 天并暂停
              </button>
            </div>
          )}
          {step === 5 && (
            <div>
              <p className="form-hint">Step 6 · 助记。在阅读器选中卡面关键词用「AI 解释」，把助记方法填入卡片（编辑后重置为新卡）。</p>
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
              处理完成 · 重置为新卡
            </button>
            <button
              className="btn btn-outline btn-sm"
              onClick={async () => {
                await cardsApi.setSuspended(card.id, false);
                await cardsApi.resolveLeech(card.id, "resumed", {});
                onDone();
              }}
            >
              仅恢复（不重置）
            </button>
          </div>
        </div>
      </div>
      {contrastOpen && <ContrastCardModal card={card} onClose={() => setContrastOpen(false)} />}
    </div>
  );
}
