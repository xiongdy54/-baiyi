// 日记页（v36，M8-A，§6.5.3）——Logseq 式流式时间线。
//
// 排版契约：**日期倒序、日组内正序**（今天在最上，组内从早到晚），今天组末是输入行/草稿行
// ——新写的内容天然出现在「当日结尾」（用户要求「追加到当日日记结尾另起一行」的字面实现）。
// 纪律：不做强制标签/分类/双链（D19 Non-Goals）；条目只作第二输入通道，不进 FSRS 队列。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { eventBus } from "../lib/eventbus";
import InsightPanel from "./InsightPanel";
import {
  formatClock,
  journalApi,
  journalDateLabel,
  todayJournalDate,
  type JournalEntry
} from "../lib/journal";

const PAGE_SIZE = 200;

export default function JournalView({ onJumpToDoc }: {
  onJumpToDoc?: (docId: string, anchor: { anchorText: string }, returnTo?: "browse") => void;
}) {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [composerText, setComposerText] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [draftEditing, setDraftEditing] = useState(false);
  const [accelerator, setAccelerator] = useState("Ctrl+Alt+Space");
  const [busy, setBusy] = useState(false);
  // v40（M8-B）：洞察面板（按需触发，禁后台自动分析）
  const [insightOpen, setInsightOpen] = useState(false);
  const today = todayJournalDate();

  const editRef = useRef<HTMLTextAreaElement | null>(null);
  const draftRef = useRef<HTMLTextAreaElement | null>(null);
  // 提交/发送的并发闸：失焦自动提交与按钮点击可能在同一帧内先后触发（React 状态尚未回落），
  // 只用 state 判忙会漏；ref 是同步的，保证同一条内容只会落一条（重复提交=凭空多一条日记）
  const submittingRef = useRef(false);

  const load = useCallback(
    async (opts: { resetLimit?: boolean } = {}) => {
      setLoading(true);
      try {
        const lim = opts.resetLimit ? PAGE_SIZE : limit;
        if (opts.resetLimit) setLimit(PAGE_SIZE);
        const res = await journalApi.list(query ? { query, limit: lim } : { limit: lim });
        setEntries(res.entries);
        setTotal(res.total);
      } finally {
        setLoading(false);
      }
    },
    [limit, query]
  );

  useEffect(() => {
    void load({ resetLimit: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // 主进程写入（快速记录窗口 / 其它入口）→ 刷新
  useEffect(() => eventBus.on("journal/changed", () => void load()) as unknown as () => void, [load]);

  // 快捷键展示（空状态提示用真实键位）
  useEffect(() => {
    void (async () => {
      const { shortcutsApi } = await import("../lib/journal");
      const st = await shortcutsApi.status();
      if (st?.quickCapture?.accelerator) setAccelerator(st.quickCapture.accelerator);
    })();
  }, []);

  const groups = useMemo(() => {
    const map = new Map<string, { sent: JournalEntry[]; draft: JournalEntry | null }>();
    for (const e of entries) {
      const bucket = map.get(e.entryDate) || { sent: [], draft: null };
      if (e.isDraft) bucket.draft = e;
      else bucket.sent.push(e);
      map.set(e.entryDate, bucket);
    }
    // entries 已按 entry_date DESC + created_at ASC 排好；组内保持正序，草稿恒在组末（未完成 → 在流的末尾）
    const list = [...map.entries()].map(([date, b]) => ({ date, sent: b.sent, draft: b.draft }));
    // 今天恒在（哪怕一条都没有）：空库与新的一天都必须能直接写下第一条，不能出现「没有输入框」的死角；
    // 搜索态不补（搜索结果是过滤器，补一个空组会让人以为今天有内容）
    if (!query && !list.some((g) => g.date === today)) list.unshift({ date: today, sent: [], draft: null });
    return list;
  }, [entries, query, today]);

  const todayGroup = groups.find((g) => g.date === today);
  const todayComposerVisible = !todayGroup || !todayGroup.draft;

  async function submitComposer() {
    const text = composerText.trim();
    if (!text || submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    try {
      await journalApi.create(composerText, { source: "app" });
      setComposerText("");
      await load();
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  async function saveEdit(id: string) {
    const text = editText;
    setEditingId(null);
    const original = entries.find((e) => e.id === id);
    if (!original || original.contentMarkdown === text) return;
    if (!text.trim()) {
      // 编辑成空 = 显式清空意图：软删该条（与快速记录「空内容不建条」同口径）
      await journalApi.remove(id);
    } else {
      await journalApi.update(id, text);
    }
    await load();
  }

  async function deleteEntry(id: string) {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      return;
    }
    setConfirmDeleteId(null);
    await journalApi.remove(id);
    await load();
  }

  // 发送草稿：走与快速记录窗口**同一条主进程契约**（journal:draftSend，定格为一条、entry_date 不变）
  async function sendDraft(draft: JournalEntry, content?: string) {
    const value = content ?? draft.contentMarkdown;
    if (!value.trim()) return;
    setBusy(true);
    try {
      await journalApi.draftSend(value);
      setDraftEditing(false);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function copyEntry(entry: JournalEntry) {
    try {
      await navigator.clipboard.writeText(entry.contentMarkdown);
    } catch {
      /* 剪贴板不可用：静默（不阻塞编辑） */
    }
  }

  useEffect(() => {
    if (editingId) editRef.current?.focus();
  }, [editingId]);
  useEffect(() => {
    if (draftEditing) draftRef.current?.focus();
  }, [draftEditing]);

  if (loading && entries.length === 0 && !query) {
    return (
      <section className="journal">
        <div className="journal-loading mono">正在读取日记…</div>
      </section>
    );
  }

  return (
    <section className="journal">
      <div className="journal-toolbar">
        <input
          className="journal-search"
          value={queryInput}
          placeholder="搜索日记内容…"
          onChange={(e) => setQueryInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") setQuery(queryInput.trim());
            if (e.key === "Escape") {
              setQueryInput("");
              setQuery("");
            }
          }}
        />
        {query && (
          <span className="journal-search-meta mono">
            命中 {total} 条
            <button
              className="journal-link"
              onClick={() => {
                setQueryInput("");
                setQuery("");
              }}
            >
              清除
            </button>
          </span>
        )}
        <span className="journal-toolbar-spacer" />
        {/* v40（M8-B）：洞察入口（日记页主操作，按需触发） */}
        <button className="btn btn-primary btn-sm" onClick={() => setInsightOpen(true)}>
          洞察
        </button>
        <span className="journal-count mono">{total} 条</span>
      </div>

      {entries.length === 0 && (
        <div className="journal-empty">
          <p className="journal-empty-title">{query ? "没有匹配的日记" : "日记还是空的"}</p>
          <p className="journal-empty-text">
            {query ? (
              "换个词试试，或清除搜索。"
            ) : (
              <>
                按下 <span className="mono journal-kbd">{accelerator}</span> 随时弹出快速记录窗口，记下随想；也可以直接在下面写。
              </>
            )}
          </p>
        </div>
      )}

      {groups.map((group) => (
        <div className="journal-day" key={group.date} id={`journal-day-${group.date}`}>
          <div className="journal-day-head">
            <span className="journal-day-date mono">{journalDateLabel(group.date, { withYear: true })}</span>
            {group.date === today && <span className="journal-day-today">今天</span>}
            <span className="journal-day-count mono">
              {group.sent.length + (group.draft ? 1 : 0)} 条
            </span>
          </div>

          {group.sent.map((entry) => (
            <article className="journal-entry" key={entry.id}>
              <span className="journal-entry-time mono">{formatClock(entry.createdAt)}</span>
              <div className="journal-entry-body">
                {editingId === entry.id ? (
                  <div className="journal-edit">
                    <textarea
                      ref={editRef}
                      className="journal-edit-area"
                      value={editText}
                      rows={Math.min(14, Math.max(3, editText.split("\n").length))}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          e.preventDefault();
                          setEditingId(null);
                        }
                        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                          e.preventDefault();
                          void saveEdit(entry.id);
                        }
                      }}
                      onBlur={() => void saveEdit(entry.id)}
                    />
                    <span className="journal-edit-hint mono">Ctrl+Enter 保存 · Esc 取消</span>
                  </div>
                ) : (
                  <div className="journal-entry-md">
                    <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                      {entry.contentMarkdown}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
              <div className="journal-entry-actions">
                <button
                  className="journal-link"
                  onClick={() => {
                    setEditingId(entry.id);
                    setEditText(entry.contentMarkdown);
                  }}
                >
                  编辑
                </button>
                <button className="journal-link" onClick={() => void copyEntry(entry)}>
                  复制
                </button>
                <button
                  className={`journal-link${confirmDeleteId === entry.id ? " journal-link-danger" : ""}`}
                  onClick={() => void deleteEntry(entry.id)}
                  onBlur={() => setConfirmDeleteId(null)}
                >
                  {confirmDeleteId === entry.id ? "确认删除" : "删除"}
                </button>
              </div>
            </article>
          ))}

          {group.draft && (
            <article className="journal-entry journal-draft">
              <span className="journal-entry-time mono">{formatClock(group.draft.createdAt)}</span>
              <div className="journal-entry-body">
                <span className="journal-draft-label mono">草稿 · 未发送</span>
                {draftEditing ? (
                  <div className="journal-edit">
                    <textarea
                      ref={draftRef}
                      className="journal-edit-area"
                      value={editText}
                      rows={Math.min(14, Math.max(3, editText.split("\n").length))}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          e.preventDefault();
                          setDraftEditing(false);
                        }
                        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                          e.preventDefault();
                          void sendDraft(group.draft!, editText);
                        }
                      }}
                    />
                    <span className="journal-edit-hint mono">Ctrl+Enter 发送 · Esc 取消</span>
                  </div>
                ) : (
                  <div className="journal-entry-md">
                    <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                      {group.draft.contentMarkdown}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
              <div className="journal-entry-actions">
                <button className="journal-link" disabled={busy} onClick={() => void sendDraft(group.draft!)}>
                  发送
                </button>
                <button
                  className="journal-link"
                  onClick={() => {
                    setDraftEditing(true);
                    setEditText(group.draft!.contentMarkdown);
                  }}
                >
                  继续写
                </button>
                <button
                  className={`journal-link${confirmDeleteId === group.draft.id ? " journal-link-danger" : ""}`}
                  onClick={() => void deleteEntry(group.draft!.id)}
                  onBlur={() => setConfirmDeleteId(null)}
                >
                  {confirmDeleteId === group.draft.id ? "确认删除" : "删除"}
                </button>
              </div>
            </article>
          )}

          {group.date === today && todayComposerVisible && (
            <div className="journal-composer">
              <textarea
                className="journal-composer-area"
                value={composerText}
                rows={Math.min(10, Math.max(1, composerText.split("\n").length))}
                placeholder="记下此刻的想法…（Enter 提交 · Shift+Enter 换行）"
                onChange={(e) => setComposerText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void submitComposer();
                  }
                }}
                onBlur={() => {
                  if (composerText.trim()) void submitComposer();
                }}
              />
              <div className="journal-composer-foot">
                <span className="journal-composer-hint mono">Enter 提交 · Shift+Enter 换行</span>
                <button className="btn btn-primary btn-sm" disabled={!composerText.trim() || busy} onClick={() => void submitComposer()}>
                  记下
                </button>
              </div>
            </div>
          )}
        </div>
      ))}

      {entries.length < total && (
        <div className="journal-more">
          <button className="btn btn-outline btn-sm" disabled={loading} onClick={() => setLimit((n) => n + PAGE_SIZE)}>
            {loading ? "加载中…" : `加载更早（还有 ${total - entries.length} 条）`}
          </button>
        </div>
      )}

      {insightOpen && (
        <InsightPanel
          onClose={() => setInsightOpen(false)}
          onJumpToDoc={(docId, anchor) => onJumpToDoc?.(docId, anchor as Parameters<NonNullable<typeof onJumpToDoc>>[1], "browse")}
        />
      )}
    </section>
  );
}
