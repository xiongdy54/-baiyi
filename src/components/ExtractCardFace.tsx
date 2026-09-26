import { useEffect, useRef, useState, type ReactNode } from "react";
import Dropdown from "./Dropdown";
import EditableText from "./EditableText";
import { extractStatusLabel, type ExtractEngine } from "../lib/sessionQueue";
import type { DueTopic } from "../lib/readingWorkflow";

const DAY = 86400000;
const PRIORITY_OPTIONS = [10, 30, 50, 70, 90];
const POSTPONE_PRESETS = [1, 3, 7, 30];

/** 距下次推送的文案（与队列口径一致：到期显示「现已到期」） */
export function nextAtText(nextAt?: number, now = Date.now()): string {
  const t = Number(nextAt);
  if (!Number.isFinite(t)) return "";
  const delta = t - now;
  if (delta <= 0) return "现已到期";
  const days = delta / DAY;
  if (days < 1) return "今日稍后推送";
  return `${Math.round(days)} 天后推送`;
}

/** `quote_range_json`（字符串或数组）→ 规范化区间；坏数据一律空数组（不抛） */
export function parseQuoteRanges(raw: unknown): Array<{ start: number; end: number }> {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(v)) return [];
  return v
    .map((r) => ({
      start: Math.max(0, Math.floor(Number((r as { start?: unknown })?.start) || 0)),
      end: Math.max(0, Math.ceil(Number((r as { end?: unknown })?.end) || 0))
    }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start);
}

/**
 * 把正文按高亮区间切成交错节点（只读渲染用，规格 §1.2 R13 落点）。
 * 区间超出正文长度一律裁剪；重叠区间按游标裁剪，保证不重复输出同一段文字。
 */
function textWithRanges(text: string, ranges: Array<{ start: number; end: number }> | null | undefined, hlRef: (el: HTMLElement | null) => void) {
  const body = String(text || "");
  const list = (ranges || []).filter((r) => r.start < body.length && r.end > r.start);
  if (!list.length) return body;
  const out: ReactNode[] = [];
  let cursor = 0;
  let first = true;
  list.forEach((r, i) => {
    const s = Math.max(cursor, r.start);
    const e = Math.min(body.length, r.end);
    if (s > cursor) out.push(body.slice(cursor, s));
    if (e > s) {
      out.push(
        <mark key={`hl-${i}`} className="extract-quote-hl" ref={first ? hlRef : undefined}>
          {body.slice(s, e)}
        </mark>
      );
      first = false;
    }
    cursor = Math.max(cursor, e);
  });
  if (cursor < body.length) out.push(body.slice(cursor));
  return out;
}

export interface ExtractFaceHandlers {
  /** 会话态的调度动作：可选——**查看态**（面包屑回看某层）不传任何写动作 */
  onAdvance?: () => void;
  onPostpone?: (days: number) => void;
  onPriority?: (priority: number) => void;
  onGraduate?: () => void;
  onEdit?: (text: string) => void;
  onOpenExtract?: () => void;
  onJumpToSource?: () => void;
  onUndo?: () => void;
  /**
   * 规格 §1.2：就地另立子摘录——文本＝卡面里**选中的那段**，没有选区时＝整条正文。
   * 由外层（ExtractReviewView → App.handleExtract）补 parentExtractId 后落库。
   */
  onExtract?: (text: string) => void;
}

/**
 * 摘录卡面（v48.22 / D58 §6.8）：沉浸式连续处理页与复习页**共用同一组件**。
 * 正文与闪卡一样可就地编辑（EditableText）；动作集＝下一条 / 推迟 / 优先级 / 毕业 / 打开摘录 / 跳转原文 / 摘录。
 * `viewOnly` ＝面包屑查看态（只读渲染 + 高亮该层范围，不出现任何调度动作）。
 */
export default function ExtractCardFace({
  extract,
  madeCardCount,
  engine,
  busy,
  viewOnly,
  quoteRanges,
  handlers
}: {
  extract: DueTopic;
  madeCardCount?: number;
  engine?: ExtractEngine;
  busy?: boolean;
  /** 查看态：只读正文 + 高亮，不出动作行（不推进调度、不改队列） */
  viewOnly?: boolean;
  /** 要呈现为高亮的区间（相对本条正文；落点用） */
  quoteRanges?: Array<{ start: number; end: number }> | null;
  handlers: ExtractFaceHandlers;
}) {
  const [postponeDays, setPostponeDays] = useState(7);
  const depth = Number(extract.depth) || 1;
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const hlRef = useRef<HTMLElement | null>(null);

  // 落点（尽力而为）：高亮段落在卡面上可见即滚到可视区中部（容器不可滚时是一次 no-op）
  useEffect(() => {
    if (!viewOnly) return;
    hlRef.current?.scrollIntoView({ block: "center" });
  }, [viewOnly, extract.id]);

  /** 「摘录」取的文本：卡面正文里的当前选区优先，无选区＝整条正文 */
  const pickExtractText = () => {
    const sel = typeof window !== "undefined" ? window.getSelection() : null;
    const picked = sel ? String(sel.toString()).trim() : "";
    const node = sel && sel.anchorNode ? sel.anchorNode : null;
    const el = node ? (node.nodeType === 1 ? (node as Element) : node.parentElement) : null;
    if (picked && el && bodyRef.current && bodyRef.current.contains(el)) return picked;
    return String(extract.contentMarkdown || "").trim();
  };

  return (
    <div className="extract-face" data-extract-id={extract.id} data-view-only={viewOnly ? "1" : undefined}>
      <div className="extract-face-meta">
        <span className="extract-face-source">
          来自《{extract.docTitle || "未知材料"}》
          {depth > 1 ? ` · 第${depth}层摘录` : ""}
        </span>
        <span className="extract-face-tags">
          <span className="mono">{extractStatusLabel(extract.status)}</span>
          <span className="mono">优先级 {extract.priority}</span>
          <span className="mono">{nextAtText(extract.topicNextAt)}</span>
          {engine === "ai-next-extract" ? <span className="badge-experimental">实验引擎</span> : null}
        </span>
      </div>

      <div className="extract-face-body" ref={bodyRef}>
        {viewOnly ? (
          <div className="extract-face-text">
            {textWithRanges(extract.contentMarkdown || "", quoteRanges, (el) => {
              hlRef.current = el;
            })}
          </div>
        ) : handlers.onEdit ? (
          <EditableText value={extract.contentMarkdown || ""} onCommit={(t) => handlers.onEdit?.(t)} />
        ) : (
          <div className="extract-face-text">{extract.contentMarkdown}</div>
        )}
      </div>

      <div className="extract-face-derived mono">
        {typeof madeCardCount === "number"
          ? madeCardCount > 0
            ? `已就此摘录制卡 ${madeCardCount} 张`
            : "尚未就此制卡"
          : ""}
      </div>

      {!viewOnly && (
        <div className="extract-face-actions">
          {handlers.onAdvance && (
            <button className="primary" disabled={busy} onClick={() => handlers.onAdvance?.()} title="处理完这条，按 A-Factor 推进调度（空格）">
              下一条
            </button>
          )}

          {handlers.onPostpone && (
            <>
              <span className="extract-postpone">
                <input
                  type="number"
                  min={1}
                  max={36500}
                  value={postponeDays}
                  onChange={(e) => setPostponeDays(Math.max(1, Math.min(36500, Number(e.target.value) || 1)))}
                  aria-label="推迟天数"
                />
                <span className="mono">天后</span>
                <button disabled={busy} onClick={() => handlers.onPostpone?.(postponeDays)}>
                  推迟
                </button>
              </span>

              <span className="extract-priority">
                <Dropdown
                  value={String(extract.priority)}
                  align="left"
                  title="快速变更优先级（越大越靠后）"
                  options={PRIORITY_OPTIONS.map((p) => ({ value: String(p), label: `优先级 ${p}` }))}
                  onChange={(v) => handlers.onPriority?.(Number(v))}
                />
              </span>
            </>
          )}

          {handlers.onExtract && (
            <button
              disabled={busy}
              onClick={() => handlers.onExtract?.(pickExtractText())}
              title="就此另立一条子摘录（正文里选中哪段就摘哪段；未选中＝整条）"
              data-extract-child
            >
              摘录
            </button>
          )}
          {handlers.onOpenExtract && (
            <button disabled={busy} onClick={() => handlers.onOpenExtract?.()} title="在阅读器中打开这条摘录（可就地制卡）">
              打开摘录
            </button>
          )}
          {handlers.onJumpToSource && (
            <button disabled={busy} onClick={() => handlers.onJumpToSource?.()} title="跳回材料中的原位置（不写入阅读进度）">
              跳转原文
            </button>
          )}
          {handlers.onGraduate && (
            <button disabled={busy} onClick={() => handlers.onGraduate?.()} title="处理后认为再无值得制卡的内容：不再推送，仍保留在卡片浏览器">
              毕业
            </button>
          )}
          {handlers.onUndo && (
            <button disabled={busy} onClick={() => handlers.onUndo?.()} title="撤销最近一次操作（Z）">
              撤销
            </button>
          )}
        </div>
      )}

      {!viewOnly && handlers.onPostpone && POSTPONE_PRESETS.length > 0 && (
        <div className="extract-face-hints mono">
          快捷推迟：{POSTPONE_PRESETS.map((d) => (
            <button key={d} disabled={busy} onClick={() => handlers.onPostpone?.(d)}>
              {d} 天
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
