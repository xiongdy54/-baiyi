import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { cardGenerator, lintCard, cardsApi, similaritySearch, type CardDraft } from "../lib/cards";
import { eventBus } from "../lib/eventbus";

interface Props {
  title: string;
  markdown: string;
  initialRatio?: number;
  contextLabel?: string;
  contextRef?: { documentId?: string; extractId?: string } | null;
  sourceTitle?: string;
  onBack: () => void;
  onProgress?: (ratio: number, lastText: string) => void;
}

type SelectionAction = "manual" | "ai-cards" | null;

export default function Reader({
  title,
  markdown,
  initialRatio = 0,
  contextLabel,
  contextRef,
  sourceTitle,
  onBack,
  onProgress
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const restoredRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const [selection, setSelection] = useState<{ x: number; y: number; text: string } | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [aiPanel, setAiPanel] = useState<{
    kind: "explain" | "cards";
    text: string;
    answer?: string;
    drafts?: CardDraft[];
    accepted?: Set<number>;
    blockReasons?: string[];
    batchId?: string;
    running: boolean;
    progress?: number;
    searching?: boolean;
    searched?: boolean;
    error?: string;
  } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 1800);
  }, []);

  // 恢复上次阅读位置
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const el = scrollRef.current;
    if (!el || initialRatio <= 0) return;
    requestAnimationFrame(() => {
      el.scrollTop = initialRatio * (el.scrollHeight - el.clientHeight);
    });
  }, [initialRatio, markdown]);

  const saveProgress = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !onProgress) return;
    const denom = el.scrollHeight - el.clientHeight;
    const ratio = denom > 0 ? Math.min(1, el.scrollTop / denom) : 0;
    let lastText = "";
    const blocks = el.querySelectorAll<HTMLElement>("h1, h2, h3, p, li, blockquote");
    for (const b of blocks) {
      const rect = b.getBoundingClientRect();
      if (rect.top >= 0 && rect.top < window.innerHeight * 0.4 && b.textContent?.trim()) {
        lastText = b.textContent.trim().slice(0, 140);
        break;
      }
    }
    onProgress(ratio, lastText);
  }, [onProgress]);

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
      text
    });
  }

  function clearSelection() {
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  }

  // ---------- 手动制卡（Phase 3：引用+可编辑副本模式） ----------
  async function handleManualCard(front: string, back: string, cloze: string, priority: number) {
    const card = {
      noteText: front || cloze,
      cardType: cloze ? "cloze" : "qa",
      frontMarkdown: front,
      backMarkdown: back,
      clozeOrds: [],
      contextRef: contextRef || null,
      sourceRef: sourceTitle ? { title: sourceTitle } : null,
      priority,
      tags: []
    };
    const issues = lintCard({
      front,
      back,
      cardType: card.cardType,
      cloze: cloze || null,
      contextPrefix: null,
      sourceRef: card.sourceRef
    });
    const created = await cardsApi.create(card);
    for (const issue of issues) {
      await cardsApi.addIssue({ cardId: created.id, ...issue, source: "lint" });
    }
    const similar = await similaritySearch.findSimilar(front || cloze, 2);
    if (similar.length > 0) {
      await cardsApi.addIssue({
        cardId: created.id,
        ruleId: "S1",
        severity: "warn",
        message: `与已有卡相似（${Math.round(similar[0].score * 100)}%）：「${similar[0].front.slice(0, 30)}…」`,
        source: "lint"
      });
    }
    eventBus.emit("cards/changed");
    setManualOpen(false);
    showToast("卡片已创建，可在复习视图查看");
  }

  // ---------- AI 制卡（Phase 13 主路径） ----------
  async function runAICards(text: string, webContext?: string) {
    setAiPanel({ kind: "cards", text, running: true, progress: 0, searched: Boolean(webContext) });
    try {
      const { batchId, result } = await cardGenerator.generateCards(
        text,
        { title: sourceTitle, section: contextLabel, webContext },
        "auto",
        (chars) => setAiPanel((p) => (p && p.kind === "cards" ? { ...p, progress: chars } : p))
      );
      setAiPanel({
        kind: "cards",
        text,
        running: false,
        progress: undefined,
        drafts: result.cards,
        accepted: new Set<number>(),
        blockReasons: result.blockReasons,
        batchId,
        searched: Boolean(webContext)
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setAiPanel({
        kind: "cards",
        text,
        running: false,
        error: msg.includes("API Key")
          ? "AI 服务尚未配置：请先在 设置 → AI 服务 中选择服务、粘贴 API Key 并保存。"
          : msg
      });
    }
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

  async function acceptDraft(draft: CardDraft, draftIndex: number, edited?: Partial<CardDraft>) {
    if (aiPanel?.accepted?.has(draftIndex)) return; // 防重复入队
    const d = { ...draft, ...edited };
    const cloze = d.cardType === "cloze" ? d.cloze || "" : "";
    const card = {
      noteText: d.front || cloze,
      cardType: d.cardType || "qa",
      frontMarkdown: d.front || "",
      backMarkdown: d.back || "",
      clozeOrds: [],
      contextPrefix: d.contextPrefix || null,
      contextRef: contextRef || null,
      mnemonic: d.mnemonic || null,
      example: d.example || null,
      sourceRef: d.sourceRef || (sourceTitle ? { title: sourceTitle } : null),
      dateStamp: d.dateStamp || null,
      priority: d.prioritySuggestion ?? 50,
      tags: [],
      knowledgePointId: d.knowledgePointId || null,
      generatedBy: "ai"
    };
    const issues = lintCard({
      front: card.frontMarkdown,
      back: card.backMarkdown,
      cardType: card.cardType,
      cloze,
      contextPrefix: card.contextPrefix,
      sourceRef: card.sourceRef,
      dateStamp: card.dateStamp,
      knowledgePointId: card.knowledgePointId
    });
    const created = await cardsApi.create(card);
    for (const issue of issues) {
      await cardsApi.addIssue({ cardId: created.id, ...issue, source: "lint" });
    }
    const similar = await similaritySearch.findSimilar(card.frontMarkdown || cloze, 2);
    if (similar.length > 0) {
      await cardsApi.addIssue({
        cardId: created.id,
        ruleId: "S1",
        severity: "warn",
        message: `与已有卡相似（${Math.round(similar[0].score * 100)}%）：「${similar[0].front.slice(0, 30)}…」`,
        source: "lint"
      });
    }
    setAiPanel((p) =>
      p && p.drafts
        ? { ...p, accepted: new Set([...(p.accepted ?? []), draftIndex]) }
        : p
    );
    eventBus.emit("cards/changed");
    showToast("已接受，进 FSRS 队列");
  }

  async function rejectAllDrafts() {
    if (aiPanel?.batchId) await cardsApi.setBatchStatus(aiPanel.batchId, "rejected");
    setAiPanel(null);
  }

  // ---------- AI 解释（Phase 12） ----------
  async function runExplain(text: string, question: string | null) {
    setAiPanel({ kind: "explain", text, answer: question ? undefined : "", running: true });
    try {
      const answer = await cardGenerator.explain(
        text,
        `${title}${contextLabel ? " · " + contextLabel : ""}`,
        question,
        (acc) => setAiPanel((p) => (p && p.kind === "explain" ? { ...p, answer: acc, running: true } : p))
      );
      setAiPanel({ kind: "explain", text, answer, running: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setAiPanel({
        kind: "explain",
        text,
        running: false,
        error:
          msg.includes("API Key")
            ? "AI 服务尚未配置：请先在 设置 → AI 服务 中选择服务、粘贴 API Key 并保存。"
            : msg
      });
    }
  }

  // ---------- 摘录 ----------
  async function handleExtract(text: string) {
    const { readingWorkflow } = await import("../lib/readingWorkflow");
    if (contextRef?.extractId) {
      await readingWorkflow.create({
        parentType: "extract",
        parentId: contextRef.extractId,
        documentId: contextRef.documentId || "",
        contentMarkdown: text
      });
    } else if (contextRef?.documentId) {
      await readingWorkflow.create({
        parentType: "document",
        parentId: contextRef.documentId,
        documentId: contextRef.documentId,
        contentMarkdown: text
      });
    }
    eventBus.emit("workflow/changed");
    showToast("已摘录进学习队列");
  }

  return (
    <div className="reader-wrap">
      <div className={`reader-body${aiPanel ? " reader-body-shifted" : ""}`}>
        <div ref={scrollRef} className="reader-scroll" onMouseUp={handleMouseUp} onScroll={handleScroll}>
          <article className="reader-markdown">
            <h1 className="reader-title">{title}</h1>
            {contextLabel && <p className="reader-context">{contextLabel}</p>}
            <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
              {markdown}
            </ReactMarkdown>
          </article>

          {selection && (
            <div className="selection-menu" style={{ left: selection.x, top: Math.max(8, selection.y) }}>
              <button onClick={() => { setManualOpen(true); clearSelection(); }}>制卡</button>
              <button onClick={() => { const t = selection.text; clearSelection(); runAICards(t); }}>AI 制卡</button>
              <button onClick={() => { const t = selection.text; clearSelection(); runExplain(t, null); }}>AI 解释</button>
              <button onClick={() => { const t = selection.text; clearSelection(); handleExtract(t); }}>摘录</button>
            </div>
          )}
        </div>

        {manualOpen && selection?.text && (
          <ManualCardEditor
            quote={selection.text}
            onCancel={() => setManualOpen(false)}
            onSave={handleManualCard}
          />
        )}

        {manualOpen && !selection?.text && (
          <ManualCardEditor
            quote=""
            onCancel={() => setManualOpen(false)}
            onSave={handleManualCard}
          />
        )}

        {aiPanel && (
          <AIPanel
            panel={aiPanel}
            onClose={() => {
              if (aiPanel.kind === "cards" && aiPanel.batchId && aiPanel.drafts?.length) {
                cardsApi.setBatchStatus(aiPanel.batchId, "rejected");
              }
              setAiPanel(null);
            }}
            onAccept={(d, idx, edited) => {
              return acceptDraft(d, idx, edited);
            }}
            onEdit={(idx, patch) => {
              setAiPanel((p) => {
                if (!p || !p.drafts) return p;
                const next = [...p.drafts];
                next[idx] = { ...next[idx], ...patch };
                return { ...p, drafts: next };
              });
            }}
            onRejectAll={rejectAllDrafts}
            onExplain={(q) => runExplain(aiPanel.text, q)}
            onMakeCards={() => runAICards(aiPanel.text)}
            onSearchBackground={() => searchAndRetry(aiPanel.text)}
          />
        )}
      </div>

      {toast && <div className="reader-toast">{toast}</div>}
    </div>
  );
}

// ---------- 手动制卡编辑器（Phase 3：引用 + 可编辑副本） ----------
function ManualCardEditor({
  quote,
  onCancel,
  onSave
}: {
  quote: string;
  onCancel: () => void;
  onSave: (front: string, back: string, cloze: string, priority: number) => Promise<void>;
}) {
  const [mode, setMode] = useState<"qa" | "cloze">("qa");
  const [front, setFront] = useState(mode === "qa" ? "" : quote);
  const [back, setBack] = useState("");
  const [priority, setPriority] = useState(50);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (mode === "qa") {
      setFront((f) => (f ? f : ""));
    } else {
      setFront(quote);
    }
  }, [mode, quote]);

  async function save() {
    setSaving(true);
    const cloze = mode === "cloze" ? toCloze(front) : "";
    if (mode === "qa") await onSave(front, back, "", priority);
    else await onSave(quote, "", cloze, priority);
    setSaving(false);
  }

  function toCloze(text: string): string {
    // 简易挖空：用户用 **粗体** 或〔〕标记答案，否则挖首个句子成分
    const bold = /\*\*(.+?)\*\*/.exec(text);
    if (bold) return text.replace(bold[0], `{{c1::${bold[1]}}}`);
    const bracket = /〔(.+?)〕/.exec(text);
    if (bracket) return text.replace(bracket[0], `{{c1::${bracket[1]}}}`);
    return text;
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>手动制卡</h2>
          <button className="icon-btn modal-close" title="关闭" onClick={onCancel}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
        <div className="modal-scroll">
        {quote && <blockquote className="card-quote">{quote}</blockquote>}

        <div className="seg-tabs">
          <button className={mode === "qa" ? "active" : ""} onClick={() => setMode("qa")}>
            问答题
          </button>
          <button className={mode === "cloze" ? "active" : ""} onClick={() => setMode("cloze")}>
            填空题
          </button>
        </div>

        {mode === "qa" ? (
          <>
            <div className="form-field">
              <label>正面（问题，建议「领域前缀: 问题」）</label>
              <textarea className="ta-short" value={front} onChange={(e) => setFront(e.target.value)} placeholder="例：统计: 中位数是什么？" />
            </div>
            <div className="form-field">
              <label>背面（答案，目标 ≤15 字）</label>
              <textarea className="ta-short" value={back} onChange={(e) => setBack(e.target.value)} placeholder="例：排序后位于中间位置的数" />
            </div>
          </>
        ) : (
          <div className="form-field">
            <label>
              挖空文本（用 **双星号** 或〔括号〕包住答案，自动转 Anki 挖空；多挖空用 c1/c2 编号语法）
            </label>
            <textarea className="ta-short" value={front} onChange={(e) => setFront(e.target.value)} />
            <p className="form-preview mono">{front.replace(/\*\*(.+?)\*\*/g, "〔$1〕")}</p>
          </div>
        )}

        <div className="form-field">
          <label>优先级（0-100，越高越先复习）</label>
          <input type="range" min={0} max={100} value={priority} onChange={(e) => setPriority(Number(e.target.value))} />
          <span className="mono">{priority}</span>
        </div>

        <div className="form-actions">
          <button className="btn btn-secondary" onClick={onCancel}>取消</button>
          <button
            className="btn btn-primary"
            disabled={saving || (mode === "qa" ? !front.trim() || !back.trim() : !front.trim())}
            onClick={save}
          >
            {saving ? "保存中…" : "创建卡片"}
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}

// ---------- AI 面板（解释侧栏 / 制卡预览） ----------
// 防 AI 返回字段类型漂移导致渲染崩溃（ruleNotes/warnings 可能是字符串）
function toList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === "string" && v.trim()) return v.split(/[,;；、]/).map((s) => s.trim()).filter(Boolean);
  return [];
}

function AIPanel({
  panel,
  onClose,
  onAccept,
  onEdit,
  onRejectAll,
  onExplain,
  onMakeCards,
  onSearchBackground
}: {
  panel: {
    kind: "explain" | "cards";
    text: string;
    answer?: string;
    drafts?: CardDraft[];
    accepted?: Set<number>;
    blockReasons?: string[];
    batchId?: string;
    running: boolean;
    progress?: number;
    searching?: boolean;
    searched?: boolean;
    error?: string;
  };
  onClose: () => void;
  onAccept: (draft: CardDraft, draftIndex: number, edited?: Partial<CardDraft>) => Promise<void>;
  onEdit: (draftIndex: number, patch: Partial<CardDraft>) => void;
  onRejectAll: () => void;
  onExplain: (question: string | null) => void;
  onMakeCards: () => void;
  onSearchBackground: () => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<Record<number, { front?: string; back?: string }>>({});

  return (
    <div className="ai-panel">
      <div className="ai-panel-head">
        <span className="ai-panel-title">{panel.kind === "explain" ? "AI 解释" : "AI 制卡"}</span>
        <button className="icon-btn" title="关闭" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>

      <div className="ai-panel-body">
        <blockquote className="ai-quote">{panel.text}</blockquote>

        {panel.kind === "cards" && panel.running && (
          <div className="ai-streaming mono">
            生成中… 已输出 {panel.progress ?? 0} 字（大模型生成长 JSON 通常需要 1-2 分钟，请保持窗口打开）
          </div>
        )}
        {panel.searching && <div className="ai-streaming mono">正在联网检索事件背景…</div>}
        {panel.error && <div className="ai-error">{panel.error}</div>}

        {panel.kind === "explain" && panel.answer && (
          <>
            <div className="ai-answer">
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                {panel.answer}
              </ReactMarkdown>
            </div>
            <div className="ai-actions">
              <button className="btn btn-outline btn-sm" onClick={() => onExplain("通俗解释")}>通俗解释</button>
              <button className="btn btn-outline btn-sm" onClick={() => onExplain("严格定义")}>严格定义</button>
              <button className="btn btn-outline btn-sm" onClick={() => onExplain("举个例子")}>举个例子</button>
              <button className="btn btn-outline btn-sm" onClick={() => onExplain("为什么会这样")}>为什么</button>
            </div>
            <div className="ai-actions">
              <button className="btn btn-secondary btn-sm" disabled={panel.running} onClick={onMakeCards}>
                就此制卡
              </button>
            </div>
          </>
        )}

        {panel.kind === "cards" && (
          <>
            {panel.blockReasons && panel.blockReasons.length > 0 && (
              <div className="ai-block-reasons">
                <p>该文本依赖未建立的理解：</p>
                <ul>{panel.blockReasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
                {!panel.searched && (
                  <div className="ai-actions">
                    <button
                      className="btn btn-outline btn-sm"
                      disabled={panel.searching || panel.running}
                      onClick={onSearchBackground}
                    >
                      {panel.searching ? "检索中…" : "搜索网络补充背景后重试"}
                    </button>
                  </div>
                )}
                {panel.searched && (
                  <p className="form-hint">已注入联网检索到的事件背景；若仍提示缺背景，建议手动补充来源文本。</p>
                )}
              </div>
            )}
            {panel.drafts?.map((rawDraft, i) => {
              if (panel.accepted?.has(i)) {
                return (
                  <div key={i} className="ai-draft ai-draft-accepted">
                    <div className="ai-draft-accepted-badge">✓ 已加入 FSRS 队列</div>
                    <div className="ai-draft-front">
                      <div className="ai-draft-text">{String(rawDraft?.front ?? "")}</div>
                    </div>
                  </div>
                );
              }
              // 深度防御：字段类型强制归一，杜绝渲染期异常
              const d: CardDraft = {
                ...(rawDraft as CardDraft),
                front: String(rawDraft?.front ?? ""),
                back: String(rawDraft?.back ?? ""),
                cloze: rawDraft?.cloze ? String(rawDraft.cloze) : null,
                contextPrefix: rawDraft?.contextPrefix ? String(rawDraft.contextPrefix) : undefined,
                ruleNotes: toList((rawDraft as CardDraft)?.ruleNotes),
                warnings: toList((rawDraft as CardDraft)?.warnings)
              };
              const issues = lintCard({
                front: d.front,
                back: d.back,
                cardType: d.cardType,
                cloze: d.cloze || null,
                contextPrefix: d.contextPrefix,
                sourceRef: d.sourceRef,
                dateStamp: d.dateStamp
              });
              const isEditing = editing === i;
              const editText = editValues[i] ?? {};
              const shownFront = editText.front !== undefined ? editText.front : (d.cardType === "cloze" ? d.cloze || d.front : d.front);
              const shownBack = editText.back !== undefined ? editText.back : d.back;
              return (
                <div key={i} className="ai-draft">
                  {isEditing ? (
                    <>
                      <textarea
                        className="ta-short mono"
                        value={shownFront}
                        onChange={(e) =>
                          setEditValues((v) => ({
                            ...v,
                            [i]: { ...v[i], front: e.target.value }
                          }))
                        }
                      />
                      <textarea
                        className="ta-short mono"
                        value={shownBack}
                        onChange={(e) =>
                          setEditValues((v) => ({
                            ...v,
                            [i]: { ...v[i], back: e.target.value }
                          }))
                        }
                      />
                      <div className="ai-actions">
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => {
                            // 把编辑写回父组件 state（drafts 数组本体）
                            onEdit(i, {
                              ...(d.cardType === "cloze" ? { cloze: shownFront } : { front: shownFront }),
                              back: shownBack,
                              // 编辑后 front/cloze 变了，同步 noteText 的来源字段
                              front: d.cardType === "cloze" ? d.front : shownFront
                            });
                            setEditValues((v) => {
                              const { [i]: _removed, ...rest } = v;
                              return rest;
                            });
                            setEditing(null);
                          }}
                        >
                          完成
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="ai-draft-front">
                        <span className="ai-draft-type mono">{d.cardType}</span>
                        {d.contextPrefix && <span className="ai-draft-prefix mono">{d.contextPrefix}</span>}
                        <div className="ai-draft-text">
                          {d.cardType === "cloze"
                            ? (d.cloze || "").replace(/\{\{c\d+::(.*?)(?:::(.*?))?\}\}/g, "〔$1〕")
                            : d.front}
                        </div>
                      </div>
                      <div className="ai-draft-back">{d.back}</div>
                      {toList(d.ruleNotes).length > 0 && (
                        <div className="ai-draft-notes mono">{toList(d.ruleNotes).join(" · ")}</div>
                      )}
                      {toList(d.warnings).length > 0 && (
                        <div className="ai-draft-warnings">⚠ {toList(d.warnings).join("；")}</div>
                      )}
                      {issues.length > 0 && (
                        <div className="ai-draft-issues">
                          {issues.map((it, j) => (
                            <span key={j} className={`lint lint-${it.severity}`}>
                              {it.ruleId} {it.message}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="ai-actions">
                        <button className="btn btn-primary btn-sm" onClick={() => onAccept(d, i)}>接受</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => setEditing(i)}>编辑</button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
            {panel.kind === "cards" && !panel.running && panel.drafts && panel.drafts.length > 0 && (
              <div className="ai-actions">
                <button className="btn btn-outline btn-sm" onClick={onRejectAll}>整批拒绝</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
