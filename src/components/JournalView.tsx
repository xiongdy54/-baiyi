// 日记页（v36，M8-A，§6.5.3）——Logseq 式流式时间线。
//
// 排版契约：**日期倒序、日组内正序**（今天在最上，组内从早到晚），今天组末是输入行/草稿行
// ——新写的内容天然出现在「当日结尾」（用户要求「追加到当日日记结尾另起一行」的字面实现）。
// 纪律：不做强制标签/分类/双链（D19 Non-Goals）；条目只作第二输入通道，不进 FSRS 队列。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isImeComposing } from "../lib/ime";
import { eventBus } from "../lib/eventbus";
import InsightPanel from "./InsightPanel";
import MarkdownEditor, { type MarkdownEditorApi } from "./editor/MarkdownEditor";
import ReadMarkdown from "./editor/ReadMarkdown";
import {
  formatClock,
  journalApi,
  journalDateLabel,
  todayJournalDate,
  type JournalEntry
} from "../lib/journal";
import { useT } from "../lib/i18n";

const PAGE_SIZE = 200;

export default function JournalView({ onJumpToDoc }: {
  onJumpToDoc?: (docId: string, anchor: { anchorText: string }, returnTo?: "browse") => void;
}) {
  const T = useT();
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
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [draftEditing, setDraftEditing] = useState(false);
  const [accelerator, setAccelerator] = useState("Ctrl+Alt+Space");
  const [busy, setBusy] = useState(false);
  // v40（M8-B）：洞察面板（按需触发，禁后台自动分析）
  const [insightOpen, setInsightOpen] = useState(false);
  const today = todayJournalDate();
  // 提交/发送的并发闸：失焦自动提交与按钮点击可能在同一帧内先后触发（React 状态尚未回落），
  // 只用 state 判忙会漏；ref 是同步的，保证同一条内容只会落一条（重复提交=凭空多一条日记）
  const submittingRef = useRef(false);
  // §J P0：三个 markdown 编辑面（条目编辑/草稿续写/当日输入行）的编辑器 API（就绪即接管焦点）
  const editMdRef = useRef<MarkdownEditorApi | null>(null);
  const draftMdRef = useRef<MarkdownEditorApi | null>(null);

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

  async function submitComposer(content?: string) {
    const source = content ?? composerText;
    const text = source.trim();
    if (!text || submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    try {
      await journalApi.create(source, { source: "app" });
      setComposerText("");
      await load();
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  /** §J P0：条目编辑提交（MarkdownEditor 幂等短路：无变更传 null＝仅收编辑器）。编辑成空＝显式
      清空意图：软删该条（与快速记录「空内容不建条」同口径，原 textarea 语义保留）。 */
  async function commitEdit(id: string, text: string | null) {
    setEditingId(null);
    if (text === null) return;
    const original = entries.find((e) => e.id === id);
    if (!original || original.contentMarkdown === text) return;
    if (!text.trim()) {
      await journalApi.remove(id);
    } else {
      await journalApi.update(id, text);
    }
    await load();
  }

  /** §J P0：草稿续写提交——内容写回**同一条草稿**（journal:update 不区分草稿/已发，落库链零新增），
      保持草稿身份；「发送」仍由发送按钮显式触发（draftSend 定格为一条），失焦/Esc 不误发。 */
  async function commitDraft(draft: JournalEntry, text: string | null) {
    setDraftEditing(false);
    if (text === null) return;
    if (!text.trim()) {
      // 编辑成空＝显式清空意图：软删草稿（与条目编辑同口径）
      await journalApi.remove(draft.id);
      await load();
      return;
    }
    if (text === draft.contentMarkdown) return;
    await journalApi.update(draft.id, text);
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
      // 「已复制」反馈：短暂置值后回落（按钮文字随之切回「复制」）
      setCopiedId(entry.id);
      window.setTimeout(() => setCopiedId((cur) => (cur === entry.id ? null : cur)), 1500);
    } catch {
      /* 剪贴板不可用：静默（不阻塞编辑） */
    }
  }

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
          placeholder={T("搜索日记内容…")}
          onChange={(e) => setQueryInput(e.target.value)}
          onKeyDown={(e) => {
            if (isImeComposing(e)) return; // 组字中的 Enter/Esc 属于输入法（确认/取消候选词）
            if (e.key === "Enter") setQuery(queryInput.trim());
            if (e.key === "Escape") {
              setQueryInput("");
              setQuery("");
            }
          }}
        />
        {query && (
          <span className="journal-search-meta mono">
            {T("命中 {n} 条", { n: total })}
            <button
              className="journal-link"
              onClick={() => {
                setQueryInput("");
                setQuery("");
              }}
            >
              {T("清除")}
            </button>
          </span>
        )}
        <span className="journal-toolbar-spacer" />
        {/* v40（M8-B）：洞察入口（日记页主操作，按需触发） */}
        <button className="btn btn-primary btn-sm" onClick={() => setInsightOpen(true)}>
          {T("洞察")}
        </button>
        <span className="journal-count mono">{T("{n} 条", { n: total })}</span>
      </div>

      {entries.length === 0 && (
        <div className="journal-empty">
          <p className="journal-empty-title">{query ? T("没有匹配的日记") : T("日记还是空的")}</p>
          <p className="journal-empty-text">
            {query ? (
              T("换个词试试，或清除搜索。")
            ) : (
              <>
                {T("按下")} <span className="mono journal-kbd">{accelerator}</span> {T("随时弹出快速记录窗口，记下随想；也可以直接在下面写。")}
              </>
            )}
          </p>
        </div>
      )}

      {groups.map((group) => (
        <div className="journal-day" key={group.date} id={`journal-day-${group.date}`}>
          <div className="journal-day-head">
            <span className="journal-day-date mono">{journalDateLabel(group.date, { withYear: true })}</span>
            {group.date === today && <span className="journal-day-today">{T("今天")}</span>}
            <span className="journal-day-count mono">
              {T("{n} 条", { n: group.sent.length + (group.draft ? 1 : 0) })}
            </span>
          </div>

          {group.sent.map((entry) => (
            <article className="journal-entry" key={entry.id}>
              <span className="journal-entry-time mono">{formatClock(entry.createdAt)}</span>
              <div className="journal-entry-body">
                {editingId === entry.id ? (
                  <div className="journal-edit">
                    {/* §J P0：主正文统一 Markdown 编辑器（幂等短路：无变更 onCommit(null)＝仅收编辑器） */}
                    <MarkdownEditor
                      ref={editMdRef}
                      value={editText}
                      variant="full"
                      minRows={3}
                      onChange={setEditText}
                      onCommit={(t) => void commitEdit(entry.id, t)}
                      className="journal-edit-md"
                      onReady={() => editMdRef.current?.focusBlock(0)}
                    />
                    <span className="journal-edit-hint mono">{T("Esc 保存 · 失焦保存 · Enter 换行")}</span>
                  </div>
                ) : (
                  <div className="journal-entry-md">
                    <ReadMarkdown text={entry.contentMarkdown} />
                  </div>
                )}
              </div>
              <div className="journal-entry-actions reveal-on-hover">
                <button
                  className="journal-link"
                  onClick={() => {
                    setEditingId(entry.id);
                    setEditText(entry.contentMarkdown);
                  }}
                >
                  {T("编辑")}
                </button>
                <button className="journal-link" onClick={() => void copyEntry(entry)}>
                  {copiedId === entry.id ? T("已复制") : T("复制")}
                </button>
                <button
                  className={`journal-link${confirmDeleteId === entry.id ? " journal-link-danger" : ""}`}
                  onClick={() => void deleteEntry(entry.id)}
                  onBlur={() => setConfirmDeleteId(null)}
                >
                  {confirmDeleteId === entry.id ? T("确认删除") : T("删除")}
                </button>
              </div>
            </article>
          ))}

          {group.draft && (
            <article className="journal-entry journal-draft">
              <span className="journal-entry-time mono">{formatClock(group.draft.createdAt)}</span>
              <div className="journal-entry-body">
                <span className="journal-draft-label mono">{T("草稿 · 未发送")}</span>
                {draftEditing ? (
                  <div className="journal-edit">
                    {/* §J P0：草稿续写用完整编辑器；提交＝写回同一条草稿（不误发），发送仍走显式按钮 */}
                    <MarkdownEditor
                      ref={draftMdRef}
                      value={editText}
                      variant="full"
                      minRows={3}
                      onChange={setEditText}
                      onCommit={(t) => void commitDraft(group.draft!, t)}
                      className="journal-edit-md"
                      onReady={() => draftMdRef.current?.focusBlock(0)}
                    />
                    <span className="journal-edit-hint mono">{T("Esc 存草稿 · 失焦存草稿 · 发送按钮定格")}</span>
                  </div>
                ) : (
                  <div className="journal-entry-md">
                    <ReadMarkdown text={group.draft.contentMarkdown} />
                  </div>
                )}
              </div>
              <div className="journal-entry-actions reveal-on-hover">
                <button className="journal-link" disabled={busy} onClick={() => void sendDraft(group.draft!)}>
                  {T("发送")}
                </button>
                <button
                  className="journal-link"
                  onClick={() => {
                    setDraftEditing(true);
                    setEditText(group.draft!.contentMarkdown);
                  }}
                >
                  {T("继续写")}
                </button>
                <button
                  className={`journal-link${confirmDeleteId === group.draft.id ? " journal-link-danger" : ""}`}
                  onClick={() => void deleteEntry(group.draft!.id)}
                  onBlur={() => setConfirmDeleteId(null)}
                >
                  {confirmDeleteId === group.draft.id ? T("确认删除") : T("删除")}
                </button>
              </div>
            </article>
          )}

          {group.date === today && todayComposerVisible && (
            <div className="journal-composer">
              {/* §J P0：当日输入行统一 Markdown 编辑器（统一方案语义：Enter=换行段落，Esc/失焦/按钮提交） */}
              <MarkdownEditor
                value={composerText}
                variant="full"
                minRows={2}
                placeholder={T("记下此刻的想法…（Enter 换行 · Esc 或失焦提交）")}
                onChange={setComposerText}
                onCommit={(t) => {
                  if (t !== null && t.trim()) void submitComposer(t);
                }}
                className="journal-composer-md"
              />
              <div className="journal-composer-foot">
                <span className="journal-composer-hint mono">{T("Esc 提交 · 失焦提交")}</span>
                <button className="btn btn-primary btn-sm" disabled={!composerText.trim() || busy} onClick={() => void submitComposer()}>
                  {T("记下")}
                </button>
              </div>
            </div>
          )}
        </div>
      ))}

      {entries.length < total && (
        <div className="journal-more">
          <button className="btn btn-outline btn-sm" disabled={loading} onClick={() => setLimit((n) => n + PAGE_SIZE)}>
            {loading ? T("加载中…") : T("加载更早（还有 {n} 条）", { n: total - entries.length })}
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
