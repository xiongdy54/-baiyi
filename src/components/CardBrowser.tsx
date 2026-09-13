// 卡片浏览界面（v19 Anki 式改造）：全量卡片表格 + 搜索/类型/状态筛选 + 排序 + 行详情维护。
// 浏览器式操作（对齐 Anki 浏览器，基于本库数据）：卡面预览与内联编辑（复用复习页 CardFace/EditableText）、
// 暂停/恢复、推迟、重置为新卡、删除、跳转原文、质检问题（CardIssue）查看、Leech 六步向导入口。
// 评分调度仍在连续刷题界面（ReviewView），此处不写复习日志。
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { parseCloze, extractClozeAnswer, cardsApi, type CardRecord, type CardIssueRecord } from "../lib/cards";
import { eventBus } from "../lib/eventbus";
import Dropdown from "./Dropdown";
import OcclusionShapes from "./OcclusionShapes";

type Preset = "all" | "due" | "leech";
type BrowserCard = CardRecord & { docTitle?: string };
type JumpToDoc = (
  docId: string,
  anchor: { anchorText: string; anchorRatio?: number; cfi?: string; chapterIndex?: number },
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
function srcLabel(c: CardRecord & { docTitle?: string }): string {
  const t = c.docTitle || c.sourceRef?.title || "";
  if (!t) return "—";
  return t.startsWith("《") ? t : `《${t}》`;
}

export default function CardBrowser({ onJumpToDoc }: { onJumpToDoc?: JumpToDoc }) {
  const [all, setAll] = useState<BrowserCard[]>([]);
  const [preset, setPreset] = useState<Preset>("all");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [stateFilter, setStateFilter] = useState("all");
  const [sortBy, setSortBy] = useState("due");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [leechTarget, setLeechTarget] = useState<BrowserCard | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    setAll(await cardsApi.listAll());
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
      suspended: all.filter((c) => c.leech?.suspended).length
    }),
    [all]
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
    const q = query.trim().toLowerCase();
    let list = all;
    if (preset === "due") list = list.filter(isDueCard);
    if (preset === "leech") list = list.filter(isLeechOrSuspended);
    if (typeFilter !== "all") list = list.filter((c) => c.cardType === typeFilter);
    if (stateFilter !== "all") {
      list = list.filter((c) => {
        if (stateFilter === "suspended") return Boolean(c.leech?.suspended);
        if (c.leech?.suspended) return false;
        const s = c.fsrs?.state ?? "new";
        return stateFilter === "learning" ? s === "learning" || s === "relearning" : s === stateFilter;
      });
    }
    if (q) {
      list = list.filter((c) =>
        [
          c.frontMarkdown,
          c.backMarkdown,
          c.noteText,
          c.contextPrefix || "",
          c.docTitle || "",
          ...(c.domain ?? []),
          ...(c.tags ?? [])
        ]
          .join("\n")
          .toLowerCase()
          .includes(q)
      );
    }
    const sorted = [...list];
    if (sortBy === "created") sorted.sort((a, b) => b.createdAt - a.createdAt);
    else if (sortBy === "priority") sorted.sort((a, b) => b.priority - a.priority);
    else if (sortBy === "lapses") sorted.sort((a, b) => (b.fsrs?.lapses ?? 0) - (a.fsrs?.lapses ?? 0));
    else sorted.sort((a, b) => (a.fsrs?.due ?? 0) - (b.fsrs?.due ?? 0)); // 默认到期升序，同复习队列
    return sorted;
  }, [all, preset, typeFilter, stateFilter, query, sortBy]);

  const detail = detailId ? all.find((c) => c.id === detailId) ?? null : null;

  return (
    <div className="queue-wrap">
      <div className="review-count mono">
        共 {all.length} 张 · 到期 {counts.due} · 难点 {counts.leech} · 暂停 {counts.suspended}
      </div>

      <div className="seg-tabs" style={{ padding: "0 var(--sp-8)" }}>
        <button className={preset === "all" ? "active" : ""} onClick={() => setPreset("all")}>
          全部卡片
        </button>
        <button className={preset === "due" ? "active" : ""} onClick={() => setPreset("due")}>
          到期卡片 ({counts.due})
        </button>
        <button className={preset === "leech" ? "active" : ""} onClick={() => setPreset("leech")}>
          记忆难点 ({counts.leech})
        </button>
      </div>

      <div className="cb-toolbar">
        <input
          className="cb-search"
          placeholder="搜索题面、答案、前缀、来源、领域、标签…"
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
      </div>

      {loaded && filtered.length === 0 && (
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
            <span>题面</span>
            <span>类型</span>
            <span>状态</span>
            <span>到期</span>
            <span className="cb-num">复习</span>
            <span className="cb-num">遗忘</span>
            <span className="cb-num">优先</span>
            <span>来源</span>
          </div>
          {filtered.map((c) => (
            <div key={c.id} className="cb-row" role="row" onClick={() => setDetailId(c.id)}>
              <span className="cb-front" title={frontPreview(c)}>
                {frontPreview(c)}
              </span>
              <span>{typeLabel(c.cardType)}</span>
              <span>{statusOf(c)}</span>
              <span className="mono">{dueText(c)}</span>
              <span className="cb-num mono">{c.fsrs?.reps ?? 0}</span>
              <span className="cb-num mono">{c.fsrs?.lapses ?? 0}</span>
              <span className="cb-num mono">{c.priority}</span>
              <span className="cb-src">{srcLabel(c)}</span>
            </div>
          ))}
        </div>
      )}

      {detail && (
        <CardDetail
          card={detail}
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
  onOpenLeech
}: {
  card: BrowserCard;
  onClose: () => void;
  onJumpToDoc?: JumpToDoc;
  onOpenLeech: (card: BrowserCard) => void;
}) {
  const [issues, setIssues] = useState<CardIssueRecord[]>([]);

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
        chapterIndex: card.contextRef.chapterIndex
      },
      "browse"
    );
  }

  const f = card.fsrs ?? {};
  const meta: [string, string][] = [
    ["类型", typeLabel(card.cardType)],
    ["状态", statusOf(card)],
    ["到期", dueText(card)],
    ["复习 / 遗忘", `${f.reps ?? 0} 次 / ${f.lapses ?? 0} 次`],
    [
      "稳定度 / 难度",
      f.stability != null && f.difficulty != null ? `${f.stability.toFixed(2)} / ${f.difficulty.toFixed(2)}` : "—"
    ],
    ["优先级", `P${card.priority}`],
    ["来源", srcLabel(card)],
    ["领域", (card.domain ?? []).join("、") || "—"],
    ["生成方式", card.generatedBy === "ai" ? "AI 生成" : "手动"],
    ["创建时间", new Date(card.createdAt).toLocaleString()]
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
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
            {card.contextRef?.documentId && onJumpToDoc && (
              <button className="btn btn-outline btn-sm" onClick={jump}>
                跳转原文 →
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
  onReveal: () => void;
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

  // 图片挖空卡（v16 展示规范）：正面 = 原图 + 主题色遮挡块（考察区域 accent 色、其余区域 ink 色）；
  // 答案面 = 原始图片（无任何遮挡覆盖）+ 答案文本。
  // v25：遮挡块支持矩形/椭圆/多边形（shapes 精确轮廓；无 shapes 的存量卡自动降级为 rects 矩形）
  if (card.cardType === "imageOcclusion" && card.occlusionJson) {
    // v29（D26）：看图问答卡（rects 空数组挂图 + frontMarkdown 题面）——正面图下方渲染题面文字
    const hasFrontText = !!(card.frontMarkdown && card.frontMarkdown !== "图中遮挡区域对应的是什么？");
    return (
      <div className="review-face">
        <div className="occlusion-stage">
          <img src={card.occlusionJson.assetPath} alt="" className="occlusion-img" />
          <OcclusionShapes occlusion={card.occlusionJson} cardOrd={card.cardOrd} hidden={showBack} />
        </div>
        {hasFrontText && !showBack && (
          <div className="review-front-text">
            {onEdit ? (
              <EditableText value={card.frontMarkdown} onCommit={(t) => onEdit({ frontMarkdown: t })} />
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
    const parsed = parseCloze(frontText);
    const ord = parsed.ords[card.cardOrd] ?? parsed.ords[0];
    // 背面问题区与正面共用同一 render(ord)——翻面前后逐字相同，挖空始终遮蔽（用户需求）
    const questionText = parsed.render(ord);
    // 答案区（v15 修复）：用户编辑过的 backMarkdown 优先显示；否则显示挖空内容
    const clozeAnswer = card.backMarkdown && card.backMarkdown.trim() ? card.backMarkdown : extractClozeAnswer(frontText, ord);
    // 问题区编辑（v12.4）：翻面后可改。用户编辑的是显示文本（当前挖空为[…]），
    // 落库时把[…]还原为原挖空语法，其余挖空按显示文本保留（若被改动则该挖空降级为普通文字）
    const questionEditable = showBack && onEdit;
    const commitQuestion = (t: string) => {
      const edit = onEdit;
      if (!edit) return;
      const originalSyntax = frontText.match(new RegExp(`\\{\\{c${ord}::(.*?)(?:::(.*?))?\\}\\}`));
      const restored = originalSyntax ? t.replace("[…]", originalSyntax[0]) : t;
      edit({ frontMarkdown: restored, noteText: restored });
    };
    return (
      <div className="review-face" onClick={!showBack ? onReveal : undefined}>
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
          </div>
        )}
      </div>
    );
  }

  // v16（D18）：翻转问答卡 = 制卡手段，创建时即拆为两张独立 qa 卡；
  // 不存在复习期形态变化的卡片类型，一切卡设计以 FSRS 为核心。

  return (
    <div className="review-face" onClick={!showBack ? onReveal : undefined}>
      <div className="review-front">
        {card.contextPrefix && <span className="review-prefix mono">{card.contextPrefix}</span>}
        {showBack && onEdit ? (
          <EditableText value={frontText} onCommit={(t) => onEdit({ frontMarkdown: t, noteText: t })} />
        ) : (
          md(frontText)
        )}
      </div>
      {showBack && (
        <div className="review-back">
          {onEdit ? (
            <EditableText value={card.backMarkdown} onCommit={(t) => onEdit({ backMarkdown: t })} />
          ) : (
            md(card.backMarkdown)
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Leech 六步处理向导（§8.7） ----------
export function LeechWizard({ card, onClose, onDone }: { card: CardRecord; onClose: () => void; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [diagnosis, setDiagnosis] = useState<{ diagnosis?: string; analysis?: string; suggestions?: string[] } | null>(null);
  const [running, setRunning] = useState(false);

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
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
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
          <div className="seg-tabs" style={{ marginBottom: "var(--sp-4)" }}>
            {steps.map((s, i) => (
              <button key={s} className={step === i ? "active" : ""} onClick={() => setStep(i)}>
                {s}
              </button>
            ))}
          </div>

          <div className="queue-row" style={{ marginBottom: "var(--sp-4)" }}>
            <div className="queue-row-text">{card.frontMarkdown || card.noteText}</div>
            <div className="queue-row-text review-back">{card.backMarkdown}</div>
          </div>

          {step === 0 && (
            <div>
              <p className="form-hint">Step 1 · 明显原因？用 AI 诊断遗忘原因（歧义/干扰/缺前置/过载/是否题残留）。</p>
              <button className="btn btn-primary btn-sm" disabled={running} onClick={runDiagnose}>
                {running ? "诊断中…" : "AI 诊断"}
              </button>
              {diagnosis && (
                <div className="review-mnemonic" style={{ marginTop: "var(--sp-3)" }}>
                  <span className="book-card-label">诊断</span>
                  {diagnosis.diagnosis || diagnosis.analysis}
                  {diagnosis.suggestions && diagnosis.suggestions.length > 0 && (
                    <ul style={{ margin: "var(--sp-2) 0 0", paddingLeft: "1.2em" }}>
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

          <div className="settings-row" style={{ marginTop: "var(--sp-5)" }}>
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
    </div>
  );
}
