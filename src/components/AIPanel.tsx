// AI 面板（解释侧栏 / 制卡预览）
// 批 4（Task 5）：从 Reader.tsx 原样搬出（纯移动，零行为改动）——摘录页与阅读器共用同一份实现。
// v48.51（D91 §5.5）：答案尾部的事后建议轻提示行（仅 auto 路由进 ste 且 points=0 且改写≈原文时
// 出现——用户多半更想要概念解释）。
// v48.100（D144 #3）：explain 分支首行的「解读方式」切换器（D91 §5.2）退役——方式表达唯一归口＝
// 解释板块悬浮按钮行（ExplainModeBar 四 ghost 钮，本文件导出）；切换即重跑（D91 §5.3）语义保留，
// 由按钮行 / 事后建议钮经宿主 changeExplainMode 承载。
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { growTextarea } from "../lib/autoGrow";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { lintCard, needsAttribution, parseCloze, parseFollowUps, type CardDraft, type CardQualifier, type CardGenMode, type FollowUpGroup, type OcclusionRegion } from "../lib/cards";
import { sanitizeDomain } from "../lib/udc";
import { isLikelySameText, parseSteMarkers, stripSteMarkers, type ExplainModePref } from "../lib/explainRouter";
import Dropdown from "./Dropdown";
import OcclusionShapes from "./OcclusionShapes";
import { IconAlert, IconCheck, IconChevronDown, IconClose, IconPencil } from "./icons";
import type { AskThreadItem } from "../lib/useSelectionActions";

// 防 AI 返回字段类型漂移导致渲染崩溃（ruleNotes/warnings 可能是字符串）
function toList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === "string" && v.trim()) return v.split(/[,;；、]/).map((s) => s.trim()).filter(Boolean);
  return [];
}

/** D121 §2.6：归属标签文案 */
function qualifierLabel(q: CardQualifier): string {
  switch (q.stance) {
    case "author": return "作者观点";
    case "reported": return q.holder ? `转述·${q.holder}` : "转述";
    case "criticized": return q.holder ? `批判对象·${q.holder}` : "批判对象";
    case "consensus": return "公认";
    default: return "归属未定";
  }
}

/** D144 §4.3：解释板块「当前方式」四值（三解读方式复用 ExplainModePref 的会话内记忆 + 自由提问） */
export type ExplainComposerMode = "auto" | "general" | "ste" | "ask";

const EXPLAIN_MODE_ITEMS: Array<[ExplainComposerMode, string]> = [
  ["auto", "自动"],
  ["general", "通用解读"],
  ["ste", "简明解读"],
  ["ask", "自由提问"]
];

/**
 * v48.100（D144 §3.1/§4.3）：解读方式悬浮按钮行（四 ghost 钮）——取代 v48.51（D91 §5.2）的
 * 解读方式下拉（该导出已退役）。按钮双职＝迁移「当前方式」+（有字时）按该方式发送；
 * §4.3 语义矩阵与发送路由由宿主 SelectionPanels 承载，本组件只呈现（§7 状态样式在 theme.css）。
 */
export function ExplainModeBar({
  mode,
  hasText,
  hasContext,
  onModeSelect
}: {
  mode: ExplainComposerMode;
  /** 输入框是否有字（§7 空输入态判定之一） */
  hasText: boolean;
  /** 是否有解释语境（解释面板在场或追问线程非空） */
  hasContext: boolean;
  onModeSelect: (m: ExplainComposerMode) => void;
}) {
  return (
    <>
      {EXPLAIN_MODE_ITEMS.map(([m, label]) => (
        <button
          key={m}
          type="button"
          className={`wb-mode-btn${mode === m ? " on" : ""}${!hasText && !hasContext ? " idle" : ""}`}
          data-mode={m}
          aria-pressed={mode === m}
          onClick={() => onModeSelect(m)}
        >
          {label}
        </button>
      ))}
    </>
  );
}

// ---------- D123：计时与状态行（静态方块点、无动画；计时自算——摘录页曾硬编码 elapsedSec=0） ----------
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [active]);
  return now;
}

export function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** 单行进度：「● 思考中 0:12 · 2052 字  [停止]」（计时＝从点击起累计，每秒刷新） */
export function AIStatus({
  startedAt,
  thinking,
  progress,
  onStop,
  label
}: {
  startedAt?: number;
  thinking?: number;
  progress?: number;
  onStop?: () => void;
  label?: string;
}) {
  const now = useNow(true);
  const chars = progress || thinking || 0;
  const text = label ?? (progress ? "生成中" : thinking ? "思考中" : "等待响应");
  return (
    <div className="ai-status" role="status" aria-live="polite" data-testid="ai-status">
      <span className="ai-status-dot" aria-hidden="true" />
      <span>{text}</span>
      <span className="mono ai-status-time">{fmtElapsed(startedAt ? now - startedAt : 0)}</span>
      {chars > 0 && <span className="mono ai-status-chars">{chars} 字</span>}
      {onStop && (
        <button type="button" className="btn btn-outline btn-sm ai-status-stop" onClick={onStop}>
          停止
        </button>
      )}
    </div>
  );
}

/** AI 解释页：自由追问线程（每条回复悬停出现「制卡」＝以该回复为材料走 AI 制卡） */
export function ExplainThread({ items, onMake }: { items: AskThreadItem[]; onMake: (answer: string) => void }) {
  if (items.length === 0) return null;
  return (
    <div className="wb-thread" data-testid="wb-thread">
      {items.map((it) => (
        <div key={it.id} className="wb-turn">
          <div className="wb-q">{it.q}</div>
          {it.running && !it.answer && <AIStatus startedAt={it.startedAt} thinking={it.thinking} />}
          {it.error && <div className="ai-error">{it.error}</div>}
          {it.answer && (
            <div className="wb-a">
              <div className="ai-answer">
                <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                  {stripSteMarkers(it.answer)}
                </ReactMarkdown>
              </div>
              {!it.running && (
                <div className="wb-a-acts">
                  <button type="button" className="ai-link" onClick={() => onMake(it.answer as string)}>
                    制卡
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** AI 解释板块底部输入条：单行 32px 与「发送」同高对齐，随输入增高（≤120px）；Enter 发送、Shift+Enter 换行、IME 组合态不发送。
 * v48.100（D144 #3）：值受控上提（宿主持有——「引用」头部插入与 #5 选单落点的数据面）；
 * ref 句柄 insertQuote＝§4.4-c「引用」动作落点：头部插入引用块（既有草稿整体保留在其后，永不覆盖）、
 * 聚焦输入框并把光标落到文末（板块开合由宿主决定——引用不自动展开，§4.4-c）。 */
export interface ChatComposerHandle {
  insertQuote: (text: string) => void;
}

export const ChatComposer = forwardRef<ChatComposerHandle, {
  busy: boolean;
  onSend: (q: string) => void;
  /** 受控值（宿主上提）；发送成功后由本组件经 onValueChange("") 清空 */
  value: string;
  onValueChange: (v: string) => void;
}>(function ChatComposer({ busy, onSend, value, onValueChange }, ref) {
  const refEl = useRef<HTMLTextAreaElement | null>(null);
  // 句柄内读最新值/回调（refs 镜像，句柄身份稳定、无陈旧闭包）
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onValueChange);
  onChangeRef.current = onValueChange;
  useLayoutEffect(() => {
    if (refEl.current) growTextarea(refEl.current, 120);
  }, [value]);
  const send = () => {
    const q = value.trim();
    if (!q || busy) return;
    onSend(q);
    onChangeRef.current("");
  };
  useImperativeHandle(
    ref,
    () => ({
      insertQuote(text: string) {
        const t = text.trim();
        if (!t) return;
        // 引用块（逐行 "> " 前缀）+ 空行；既有草稿保留在其后（§4.4-c 永不覆盖）
        const block = t.split("\n").map((l) => `> ${l}`).join("\n") + "\n\n";
        onChangeRef.current(block + valueRef.current);
        requestAnimationFrame(() => {
          const el = refEl.current;
          if (el) {
            el.focus();
            el.setSelectionRange(el.value.length, el.value.length); // 光标落文末
          }
        });
      }
    }),
    []
  );
  return (
    <div className="wb-composer" data-testid="wb-composer">
      <textarea
        ref={refEl}
        rows={1}
        value={value}
        aria-label="追问 AI"
        placeholder="追问，或自由提问…"
        onChange={(e) => onValueChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
      />
      <button type="button" className="btn btn-primary btn-sm wb-composer-send" disabled={!value.trim() || busy} onClick={send}>
        发送
      </button>
    </div>
  );
});

type KpGroup = { kpTitle: string; items: string[] };

/** AI 制卡页「知识点与后续可补」：勾选 · 条目（✎ 可编辑）· 解释（完成后可展开/收起）；
    制卡只有两条路径——勾选后底部批量条，或展开解释里的「制卡」（行内不再有重复的制卡钮）。 */
function FollowUpList({
  panel,
  groups,
  onExploration,
  onFollowUpCards
}: {
  panel: {
    running: boolean;
    followUpBusy?: string[];
    followUpErrors?: Record<string, string>;
    explorations?: { id: number; item: string; srcKey?: string; answer?: string; running: boolean; startedAt?: number; thinking?: number; error?: string }[];
  };
  groups: KpGroup[];
  onExploration: (item: string, kpTitle: string, srcKey?: string) => void;
  onFollowUpCards: (item: string, kpTitle: string, hint?: string) => void | Promise<void>;
}) {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [making, setMaking] = useState(false);
  const textOf = (item: string) => edited[item] ?? item;
  const expOf = (item: string) =>
    (panel.explorations ?? []).filter((e) => (e.srcKey ?? e.item) === item && e.item === textOf(item)).pop();
  const all = groups.flatMap((g) => g.items.map((item) => ({ item, kpTitle: g.kpTitle })));
  const picked = all.filter((x) => checked.has(x.item));
  const toggle = (item: string) =>
    setChecked((s) => {
      const n = new Set(s);
      if (n.has(item)) n.delete(item);
      else n.add(item);
      return n;
    });
  const startEdit = (item: string) => {
    setEditing(item);
    setDraft(textOf(item));
  };
  const commitEdit = (item: string) => {
    const v = draft.trim();
    setEditing(null);
    if (v && v !== textOf(item)) setEdited((m) => ({ ...m, [item]: v }));
  };
  const makeAll = async () => {
    setMaking(true);
    try {
      for (const x of picked) {
        const exp = expOf(x.item);
        await onFollowUpCards(textOf(x.item), x.kpTitle, exp?.answer);
      }
      setChecked(new Set());
    } finally {
      setMaking(false);
    }
  };
  return (
    <div className="ai-kps" data-testid="ai-kps">
      <div className="ai-kps-head">
        <span className="ai-kps-title">知识点与后续可补</span>
        <button
          type="button"
          className="ai-link"
          onClick={() => setChecked(picked.length === all.length ? new Set() : new Set(all.map((x) => x.item)))}
        >
          {picked.length === all.length ? "取消全选" : "全选"}
        </button>
      </div>
      {groups.map((g, gi) => (
        <div key={gi} className="ai-kp">
          <div className="ai-kp-title">{g.kpTitle}</div>
          {g.items.map((item) => {
            const text = textOf(item);
            const exp = expOf(item);
            const busy = (panel.followUpBusy ?? []).includes(text);
            const err = panel.followUpErrors?.[text];
            const isOpen = open.has(item);
            const explainBtn = exp?.running ? (
              <button type="button" className="ai-kp-explain is-busy" disabled>
                解释中
              </button>
            ) : exp?.answer ? (
              <button
                type="button"
                className="ai-kp-explain is-done"
                aria-expanded={isOpen}
                onClick={() =>
                  setOpen((s) => {
                    const n = new Set(s);
                    if (n.has(item)) n.delete(item);
                    else n.add(item);
                    return n;
                  })
                }
              >
                {isOpen ? "收起" : "展开"}
                <IconChevronDown size={11} className={isOpen ? "is-flip" : undefined} />
              </button>
            ) : (
              <button
                type="button"
                className="ai-kp-explain"
                disabled={panel.running}
                onClick={() => {
                  onExploration(text, g.kpTitle, item);
                  setOpen((s) => new Set(s).add(item));
                }}
              >
                {exp?.error ? "重试" : "解释"}
              </button>
            );
            return (
              <div key={item} className="ai-kp-item" data-testid="ai-kp-item">
                <div className="ai-kp-row">
                  <input
                    type="checkbox"
                    className="ai-kp-check"
                    checked={checked.has(item)}
                    aria-label={`选择：${text}`}
                    onChange={() => toggle(item)}
                  />
                  {editing === item ? (
                    <>
                      <input
                        className="ai-kp-edit"
                        value={draft}
                        autoFocus
                        aria-label="编辑条目"
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.nativeEvent.isComposing) commitEdit(item);
                          else if (e.key === "Escape") {
                            e.stopPropagation();
                            setEditing(null);
                          }
                        }}
                      />
                      <button type="button" className="ai-icon" title="确定" onClick={() => commitEdit(item)}>
                        <IconCheck size={13} />
                      </button>
                      <button type="button" className="ai-icon" title="取消" onClick={() => setEditing(null)}>
                        <IconClose size={13} />
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="ai-kp-text">{text}</span>
                      <button type="button" className="ai-icon ai-kp-pencil" title="编辑条目（改成你想了解的内容再点解释）" onClick={() => startEdit(item)}>
                        <IconPencil size={13} />
                      </button>
                      {explainBtn}
                    </>
                  )}
                </div>
                {exp?.running && <div className="ai-kp-note mono">AI 正在回答…</div>}
                {exp?.error && <div className="ai-error">{exp.error}</div>}
                {err && <div className="lint lint-error">{err}</div>}
                {busy && <div className="ai-kp-note mono">补充制卡中…</div>}
                {isOpen && exp?.answer && (
                  <div className="ai-kp-exp">
                    <div className="ai-answer">
                      <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                        {stripSteMarkers(exp.answer)}
                      </ReactMarkdown>
                    </div>
                    {!exp.running && (
                      <div className="ai-kp-exp-foot">
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          disabled={busy || panel.running}
                          onClick={() => void onFollowUpCards(text, g.kpTitle, exp.answer)}
                        >
                          制卡
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
      {picked.length > 0 && (
        <div className="ai-kps-bar" data-testid="ai-kps-bar">
          <span>已选 {picked.length} 项</span>
          <button type="button" className="btn btn-primary btn-sm" disabled={making || panel.running} onClick={() => void makeAll()}>
            {making ? "制卡中…" : `制卡 (${picked.length})`}
          </button>
        </div>
      )}
    </div>
  );
}

export default function AIPanel({
  panel,
  onAccept,
  onAcceptOcclusion,
  onEdit,
  onSplitReverse,
  onRejectAll,
  onExplain,
  onMakeCards,
  onModeChange,
  mode = "auto",
  onSearchBackground,
  onFollowUpCards,
  onExploration,
  onAsk,
  explainMode = "auto",
  onExplainModeChange,
  /** v48.74（D118 §3④）：生成中「停止」——经宿主 stopAIRun() 走 ai:abort 取消当前请求 */
  onStop,
  elapsedTick = 0
}: {
  panel: {
    kind: "explain" | "cards" | "occlusion";
    text: string;
    answer?: string;
    drafts?: CardDraft[];
    accepted?: Set<number>;
    blockReasons?: string[];
    batchId?: string;
    running: boolean;
    progress?: number;
    thinking?: number;
    startedAt?: number;
    elapsedSec?: number;
    searching?: boolean;
    searched?: boolean;
    error?: string;
    mode?: CardGenMode;
    routeLabel?: string;
    routeForm?: string;
    image?: { dataUrl: string; assetPath: string };
    regions?: OcclusionRegion[];
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
  };
  onAccept: (draft: CardDraft, draftIndex: number, edited?: Partial<CardDraft>) => Promise<void>;
  onAcceptOcclusion: (draft: CardDraft, draftIndex: number) => Promise<void>;
  onEdit: (draftIndex: number, patch: Partial<CardDraft>) => void;
  onSplitReverse: (draftIndex: number) => void;
  onRejectAll: () => void;
  onExplain: (question: string | null) => void;
  onMakeCards: () => void;
  onModeChange: (mode: CardGenMode) => void;
  mode?: CardGenMode;
  onSearchBackground: () => void;
  onFollowUpCards: (item: string, kpTitle: string, hint?: string) => void | Promise<void>;
  onExploration: (item: string, kpTitle: string, srcKey?: string) => void;
  /** D123：解释页快捷追问（通俗解释/严格定义…）走自由追问线程；缺省回落 onExplain（替换式） */
  onAsk?: (question: string) => void;
  /** v48.51（D91 §5.2）：解读方式三态（会话内记忆，auto=默认） */
  explainMode?: ExplainModePref;
  /** v48.51（D91 §5.3）：切换即重跑（重发请求在宿主 changeExplainMode） */
  onExplainModeChange?: (m: ExplainModePref) => void;
  /** v48.74（D118 §3④）：生成中「停止」（缺省不渲染按钮——宿主未接取消通道时） */
  onStop?: () => void;
  elapsedTick?: number;
}) {
  const [qualInput, setQualInput] = useState<Record<number, string>>({});
  const [editing, setEditing] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<Record<number, { front?: string; back?: string }>>({});
  // v46（M14-UM2，§6.7.3）：memoryRef 校验失败的卡「情境来源存疑」默认不勾选——接受按钮需二次点击确认
  const [memoryWarnArmed, setMemoryWarnArmed] = useState<Set<number>>(new Set());
  // v48.51（D91 §5.5 事后建议）：仅 auto 路由进 ste 的结果、流式完成后，机器标记 points=0
  // 且改写与原文几乎一致（文本其实清晰，用户多半更想要概念解释）→ 答案尾部一行轻提示。
  // 显式选择「简明解读」= 用户自判需要简化流程，不打扰（§4.1 门控取消的本意）。
  const steMarkers = panel.kind === "explain" && panel.answer ? parseSteMarkers(panel.answer) : null;
  const suggestGeneral =
    panel.kind === "explain" &&
    !!panel.answer &&
    !panel.running &&
    !panel.error &&
    explainMode === "auto" &&
    !!onExplainModeChange &&
    steMarkers !== null &&
    steMarkers.points === 0 &&
    isLikelySameText(panel.text, stripSteMarkers(panel.answer));
  const isOcclusion = panel.kind === "occlusion";
  const followUpGroups: FollowUpGroup[] = panel.kps ? parseFollowUps(panel.kps) : [];
  const nowTick = elapsedTick;
  const busySec = (item: string) => {
    const started = panel.followUpStarted?.[item];
    return started ? Math.max(0, Math.round((nowTick - started) / 1000)) : 0;
  };
  const explSec = (e: { startedAt?: number }) =>
    e.startedAt ? Math.max(0, Math.round((nowTick - e.startedAt) / 1000)) : 0;

  return (
    <div className="ai-panel">
      {/* v48.52（D92 §6.1）：CardDock 头行改为页签条（AI 解释｜AI 制卡）+「＋制卡」+ 收起/关闭，
          不再承载标题（`.ai-panel-title` 仅存于 DictPanel 自有头行）；关闭＝dock 的 data-dock-close 钮，
          走宿主既有关闭链含批次 reject。本组件只渲染 .ai-panel-body（全部钩子零改动）。 */}

      <div className="ai-panel-body">
        <blockquote className="ai-quote">{panel.text}</blockquote>

        {/* D123：单行进度（计时自算，不再依赖宿主传入的 elapsedSec——摘录页曾硬编码 0）；
            v48.74（D118 §3④）：生成中可手动停止 */}
        {(panel.kind === "cards" || isOcclusion) && panel.running && (
          <AIStatus startedAt={panel.startedAt} thinking={panel.thinking} progress={panel.progress} onStop={onStop} />
        )}
        {panel.searching && <div className="ai-streaming mono">正在联网检索事件背景…</div>}
        {panel.error && <div className="ai-error">{panel.error}</div>}

        {panel.kind === "explain" && panel.running && !panel.answer && (
          <AIStatus startedAt={panel.startedAt} thinking={panel.thinking} onStop={onStop} />
        )}

        {panel.kind === "explain" && panel.answer && (
          <>
            <div className="ai-answer">
              {/* v48.74（D118 §3①）：渲染前剥离 <!--ste:…--> 机器标记——react-markdown@10 会把
                  未挂 rehype-raw 的 HTML 注释以转义文本渲染出来（D91 的「不可见」假设不成立）；
                  panel.answer 数据层原样保留（parseSteMarkers / 相似性判定不受影响） */}
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                {stripSteMarkers(panel.answer)}
              </ReactMarkdown>
            </div>
            {/* v48.51（D91 §5.5）：事后建议——路由错配的语义级纠偏，点击即按通用解读重跑（reader-explain scope） */}
            {suggestGeneral && (
              <div className="ai-suggest" data-testid="explain-suggest">
                <span>这段更像概念解释，切换到通用解读？</span>
                <button className="btn btn-outline btn-sm" onClick={() => onExplainModeChange?.("general")}>
                  切换到通用解读
                </button>
              </div>
            )}
            {/* v48.104（D149 ⑤）：追问快捷钮与「就此制卡」合并为一行胶囊链（样式在 theme.css
                .ai-actions 作用域精修）；「就此制卡」margin-inline-start:auto 靠右、accent-soft 淡色 */}
            <div className="ai-actions">
              {([["通俗解释", "通俗解释"], ["严格定义", "严格定义"], ["举个例子", "举个例子"], ["为什么", "为什么会这样"]] as const).map(([label, q]) => (
                <button key={label} className="btn btn-outline btn-sm" onClick={() => (onAsk ? onAsk(q) : onExplain(q))}>
                  {label}
                </button>
              ))}
              <button className="btn btn-secondary btn-sm" disabled={panel.running} onClick={onMakeCards}>
                就此制卡
              </button>
            </div>
          </>
        )}

        {/* M1.2：材料类型路由展示 + 手动覆盖 */}
        {panel.kind === "cards" && (
          <div className="ai-route-row" data-testid="ai-route-row">
            <span className="ai-route-label">材料类型</span>
            <Dropdown
              align="left"
              title="材料类型"
              value={mode}
              options={[
                { value: "auto", label: "自动识别" },
                { value: "card-generation", label: "概念论述" },
                { value: "card-formula", label: "公式推导" },
                { value: "card-seq", label: "流程背诵" },
                { value: "card-enum", label: "枚举清单" },
                { value: "card-literature", label: "文学/诗歌背诵" }
              ]}
              onChange={(m) => onModeChange(m as CardGenMode)}
            />
            <span className="ai-route-meta mono">
              {panel.routeLabel ? `${mode === "auto" ? `识别为${panel.routeLabel} · ` : ""}默认形式：${panel.routeForm}` : ""}
            </span>
            {(panel.drafts?.length || panel.error) && !panel.running && (
              <button type="button" className="ai-link ai-route-rerun" title="按当前材料类型重新生成" onClick={onMakeCards}>
                重跑
              </button>
            )}
          </div>
        )}

        {/* D123：知识点与后续可补（勾选 · 可编辑条目 · 解释；解释内容行内展开，已并入原「询问 AI 相关内容」区） */}
        {panel.kind === "cards" && followUpGroups.length > 0 && (
          <FollowUpList
            panel={panel}
            groups={followUpGroups}
            onExploration={onExploration}
            onFollowUpCards={onFollowUpCards}
          />
        )}

        {isOcclusion && panel.image && !panel.running && (
          <div className="occlusion-stage occlusion-preview">
            <img src={panel.image.assetPath} alt="" className="occlusion-img" />
            {/* v25：形状化预览（矩形/椭圆/多边形）——与复习端同口径渲染 */}
            <OcclusionShapes
              occlusion={{
                rects: (panel.regions ?? []).map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h, ord: r.ord })),
                shapes: (panel.regions ?? []).map((r) => r.shape ?? null)
              }}
              cardOrd={0}
              variant="proposal"
            />
            {(panel.regions ?? []).map((r) => (
              <span
                key={r.ord}
                className="occlusion-ord mono"
                style={{ left: `${r.x}%`, top: `${r.y}%` }}
              >
                {r.ord + 1}
              </span>
            ))}
          </div>
        )}

        {(panel.kind === "cards" || isOcclusion) && (
          <>
            {panel.blockReasons && panel.blockReasons.length > 0 && (
              <div className="ai-block-reasons">
                <p>该{isOcclusion ? "图片" : "文本"}依赖未建立的理解：</p>
                <ul>{panel.blockReasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
                {!isOcclusion && !panel.searched && (
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
                {!isOcclusion && panel.searched && (
                  <p className="form-hint">已注入联网检索到的事件背景；若仍提示缺背景，建议手动补充来源文本。</p>
                )}
              </div>
            )}
            {panel.drafts?.map((rawDraft, i) => {
              if (panel.accepted?.has(i)) {
                return (
                  <div key={i} className="ai-draft card-fill ai-draft-accepted">
                    <div className="ai-draft-accepted-badge">已加入 FSRS 队列</div>
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
                domain: sanitizeDomain((rawDraft as CardDraft)?.domain),
                ruleNotes: toList((rawDraft as CardDraft)?.ruleNotes),
                warnings: toList((rawDraft as CardDraft)?.warnings)
              };
              // v29 D26 逐张分流：面板可混排遮挡卡与看图问答卡——按 draft 自身判断
              // 遮挡 draft = imageOcclusion 且带非空 rects；看图问答 draft = imageOcclusion 且 rects 空（挂图无遮挡）
              const dIsOcc = d.cardType === "imageOcclusion" && !!d.occlusion && d.occlusion.rects.length > 0;
              const issues = lintCard({
                front: d.front,
                back: d.back,
                cardType: d.cardType,
                occlusion: d.occlusion ? { assetPath: d.occlusion.assetPath, rects: d.occlusion.rects } : null,
                cloze: d.cloze || null,
                contextPrefix: d.contextPrefix,
                sourceRef: d.sourceRef,
                dateStamp: d.dateStamp
              });
              const isEditing = editing === i;
              const editText = editValues[i] ?? {};
              const shownFront = editText.front !== undefined ? editText.front : (d.cardType === "cloze" ? d.cloze || d.front : d.front);
              const shownBack = editText.back !== undefined ? editText.back : d.back;
              const occlLabel = d.occlusion?.label ? d.occlusion.label : "";
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
                        {/* v30（D27）：分答多空卡徽标——接受时自动拆成每空一张 */}
                        {d.cardType === "cloze" && d.clozeMode === "per-blank" && (
                          <span className="ai-draft-supplement mono">
                            分答·拆{Math.max(2, parseCloze(d.cloze || d.front || "").ords.length)}张
                          </span>
                        )}
                        {panel.supplemental?.has(i) && <span className="ai-draft-supplement mono">补充</span>}
                        {d.contextPrefix && <span className="ai-draft-prefix mono">{d.contextPrefix}</span>}
                        {/* D121 §2.6：R21 归属标签——unknown 用既有 warn 色（lint-warn），其余沿用前缀行同款样式 */}
                        {d.qualifier && (
                          <span
                            className={d.qualifier.stance === "unknown" ? "lint lint-warn mono" : "ai-draft-prefix mono"}
                            title={d.qualifier.note ?? undefined}
                            data-testid="draft-qualifier"
                            data-stance={d.qualifier.stance}
                          >
                            {qualifierLabel(d.qualifier)}
                          </span>
                        )}
                        <div className="ai-draft-text">
                          {d.cardType === "cloze"
                            ? (d.cloze || "").replace(/\{\{c\d+::(.*?)(?:::(.*?))?\}\}/g, "〔$1〕")
                            : d.front}
                        </div>
                      </div>
                      <div className="ai-draft-back">{d.back}</div>
                      {dIsOcc && occlLabel && (
                        <div className="ai-draft-notes mono">区域 {(d.ord ?? d.occlusion?.ord ?? 0) + 1} · {occlLabel}</div>
                      )}
                      {toList(d.ruleNotes).length > 0 && (
                        <div className="ai-draft-notes mono">{toList(d.ruleNotes).join(" · ")}</div>
                      )}
                      {toList(d.warnings).length > 0 && (
                        <div className="ai-draft-warnings"><IconAlert size={14} /> {toList(d.warnings).join("；")}</div>
                      )}
                      {/* v46（M14-UM2，§6.7.3）：记忆接地轻标记——成功「情境来自记忆」（点开看引用行），
                          失败「情境来源存疑」（默认不勾选：接受按钮需二次点击确认，不阻断整批） */}
                      {d.memoryRef && (
                        <div className="ai-draft-issues">
                          <span
                            className={`lint ${d.memoryRefValid ? "lint-info" : "lint-warn"}`}
                            title={`引用记忆行：${d.memoryRef}${d.memoryRefValid ? "" : "\n（该行未能在本次注入的记忆块中找到——可能记忆已被整理更新）"}`}
                          >
                            {d.memoryRefValid ? "情境来自记忆" : "情境来源存疑"}
                          </span>
                        </div>
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
                      {/* D121 §2.6：归属未定 / 缺 qualifier 且含观点性措辞 → 单行「补限定」，拼到 front（cloze 卡拼到 cloze 文本）开头 */}
                      {!dIsOcc && (d.qualifier?.stance === "unknown" || (!d.qualifier && needsAttribution(d.cardType === "cloze" ? d.cloze || d.front : d.front, d.contextPrefix))) && (
                        <div className="ai-actions" data-testid="draft-add-qualifier">
                          <input
                            className="mono"
                            style={{ flex: 1, minWidth: 0 }}
                            placeholder="补限定（如：桑德尔认为，）"
                            value={qualInput[i] ?? ""}
                            onChange={(e) => setQualInput((v) => ({ ...v, [i]: e.target.value }))}
                          />
                          <button
                            className="btn btn-outline btn-sm"
                            disabled={!(qualInput[i] ?? "").trim()}
                            onClick={() => {
                              const text = (qualInput[i] ?? "").trim();
                              if (!text) return;
                              const q: CardQualifier = { stance: "reported", holder: [...text].slice(0, 60).join(""), note: d.qualifier?.note ?? null };
                              onEdit(i, d.cardType === "cloze" ? { cloze: text + (d.cloze || ""), qualifier: q } : { front: text + d.front, qualifier: q });
                              setQualInput((v) => {
                                const { [i]: _r, ...rest } = v;
                                return rest;
                              });
                            }}
                          >
                            补上
                          </button>
                        </div>
                      )}
                      <div className="ai-actions">
                        {dIsOcc ? (
                          <button className="btn btn-primary btn-sm" onClick={() => onAcceptOcclusion(d, i)}>接受</button>
                        ) : d.memoryRef && d.memoryRefValid === false && !memoryWarnArmed.has(i) ? (
                          <button
                            className="btn btn-secondary btn-sm"
                            title="情境来源存疑：该记忆引用未能校验。再点一次确认接受（可自行决定保留），点「编辑」可删掉情境。"
                            onClick={() => setMemoryWarnArmed((s) => new Set([...s, i]))}
                          >
                            情境存疑·仍接受？
                          </button>
                        ) : (
                          <button className="btn btn-primary btn-sm" onClick={() => onAccept(d, i)}>接受</button>
                        )}
                        <button className="btn btn-secondary btn-sm" onClick={() => setEditing(i)}>编辑</button>
                        {d.cardType === "qa" && (
                          <button
                            className="btn btn-secondary btn-sm"
                            title="拆为两张互为翻转的独立问答卡（各自有独立 FSRS 调度状态）"
                            onClick={() => onSplitReverse(i)}
                          >
                            转翻转卡
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
            {(panel.kind === "cards" || isOcclusion) && !panel.running && panel.drafts && panel.drafts.length > 0 && (
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
