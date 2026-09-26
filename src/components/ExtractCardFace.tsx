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
 * DOM 文本坐标（规格 §1.2 / 工单 ②）：自 root 起按文档序累加文本节点长度，`<br>` 计 1 个换行。
 * `EditableText` 的落库口径是 `innerText`，而 Chromium 的 innerText setter 把 `\n` 落成 `<br>`
 * （实测：`"a\n\nb"` → `a<br><br>b`，见 tests/breadcrumb.gui.mjs 的多段正文用例）——
 * 因此「文本节点长度 + br 计 1」与 `content_markdown` 逐字符同构，选区偏移可直接当范围锚用。
 */
function domTextOffset(root: Node, container: Node, offset: number): number | null {
  let acc = 0;
  let hit: number | null = null;
  const visit = (node: Node): void => {
    if (hit !== null) return;
    if (node === container) {
      if (node.nodeType === 3 /* TEXT_NODE */) {
        hit = acc + offset;
        return;
      }
      // 元素容器：点＝「第 offset 个子节点之前」，先把之前的兄弟累加完再落点
      const kids = node.childNodes;
      for (let i = 0; i < offset && i < kids.length; i++) visit(kids[i]);
      if (hit === null) hit = acc;
      return;
    }
    if (node.nodeType === 3) {
      acc += (node.textContent || "").length;
      return;
    }
    if (node.nodeType === 1 && (node as Element).tagName === "BR") {
      acc += 1;
      return;
    }
    if (node.nodeType === 1) {
      const kids = node.childNodes;
      for (let i = 0; i < kids.length; i++) visit(kids[i]);
    }
  };
  visit(root);
  return hit;
}

/**
 * 当前选区在**该卡正文**里的字符偏移（纯函数式，不写 DOM、不落库；工单 ②「采集父侧偏移」）。
 * 多段不相邻选择＝多组偏移（`selection.rangeCount > 1` 时逐段取；与阅读器侧 spans 集合同构），
 * 选区落在正文之外（如卡面元信息行）或塌缩时返回空数组——调用方据此回退「整条正文」。
 */
export function selectionOffsetsInBody(root: HTMLElement): Array<{ start: number; end: number }> {
  const sel = typeof window !== "undefined" ? window.getSelection() : null;
  if (!sel || !sel.rangeCount) return [];
  const out: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < sel.rangeCount; i++) {
    const r = sel.getRangeAt(i);
    if (!root.contains(r.commonAncestorContainer)) continue;
    const s = domTextOffset(root, r.startContainer, r.startOffset);
    const e = domTextOffset(root, r.endContainer, r.endOffset);
    if (s === null || e === null || e <= s) continue;
    out.push({ start: s, end: e });
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * 「摘录」动作的载荷（工单 ②）：文本＝卡面里选中的那段（无选区＝整条正文），
 * ranges＝选区在**本卡 content_markdown** 里的字符偏移（父卡坐标，逐段对应；多段选择即多组）。
 * 文本取 `slice` 而非 `selection.toString()`：落库文本与范围锚逐字符对齐（父卡跳回来高亮的就是它）。
 */
export interface ExtractPickPayload {
  text: string;
  ranges: Array<{ start: number; end: number }>;
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
   * 规格 §1.2：就地另立子摘录——载荷＝卡面里**选中的那段**（文本 + 该段在本卡正文里的字符偏移），
   * 没有选区时＝整条正文（`ranges` ＝整条区间）。父侧偏移由外层写进子摘录 contextRef.parentRange，
   * 子卡「跳转原文」据此回到父卡并高亮所选那句。
   */
  onExtract?: (payload: ExtractPickPayload) => void;
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
  /**
   * 选区的**快照**（工单 ②「多段不相邻选择＝多组偏移，复用既有的多段集合状态」在摘录页的落点）：
   * 选区一做出就在 mouseup / keyup 采集下来，作为「摘录」的兜底载荷——
   * 点按钮/别处点击**可能**动到 DOM 选区，而快照保证「选中哪段就摘哪段」不依赖那个时刻的活选区。
   * 优先级：实时选区 > 快照 > 整条正文（见 pickExtractPayload）。
   */
  const [picked, setPicked] = useState<ExtractPickPayload | null>(null);
  const depth = Number(extract.depth) || 1;
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const hlRef = useRef<HTMLElement | null>(null);

  // 换卡即清快照（偏移是相对**这一版正文**的，跨卡复用会把范围锚写歪）
  useEffect(() => {
    setPicked(null);
  }, [extract.id]);

  useEffect(() => {
    if (viewOnly) return;
    const body = bodyRef.current;
    if (!body) return;
    const face = body.closest(".extract-face");
    const capture = () => {
      const full = String(extract.contentMarkdown || "");
      const ok = selectionOffsetsInBody(body).filter((r) => r.start < full.length && r.end <= full.length);
      const text = ok.map((r) => full.slice(r.start, r.end)).join("\n\n");
      setPicked(ok.length && text.trim() ? { text, ranges: ok } : null);
    };
    const onUp = (e: Event) => {
      const t = e.target as Node | null;
      if (t && body.contains(t)) {
        capture();
        return;
      }
      // 卡外落下＝旧快照已失效；卡内按钮（如「摘录」）自身的 mouseup 不算，快照要活到 onClick
      if (!(t && face && face.contains(t))) setPicked(null);
    };
    const onKey = () => {
      const a = document.activeElement;
      if (a && (a === body || body.contains(a))) capture();
    };
    document.addEventListener("mouseup", onUp);
    document.addEventListener("keyup", onKey);
    return () => {
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("keyup", onKey);
    };
  }, [extract.id, extract.contentMarkdown, viewOnly]);

  // 落点（尽力而为）：高亮段落在卡面上可见即滚到可视区中部（容器不可滚时是一次 no-op）
  useEffect(() => {
    if (!viewOnly) return;
    hlRef.current?.scrollIntoView({ block: "center" });
  }, [viewOnly, extract.id]);

  /**
   * 「摘录」取的载荷：**实时选区优先、快照兜底**（含父卡坐标的范围），两者皆无＝整条正文。
   * 选区在正文之外（元信息行等）时同样回退整条——不用外部选区当锚，避免把范围锚写歪。
   */
  const pickExtractPayload = (): ExtractPickPayload => {
    const body = bodyRef.current;
    const full = String(extract.contentMarkdown || "");
    const live = body ? selectionOffsetsInBody(body).filter((r) => r.start < full.length && r.end <= full.length) : [];
    const fresh: ExtractPickPayload | null = live.length
      ? { text: live.map((r) => full.slice(r.start, r.end)).join("\n\n"), ranges: live }
      : null;
    for (const cand of [fresh, picked]) {
      if (cand && cand.ranges.length && cand.text.trim()) return cand;
    }
    return { text: full.trim(), ranges: [{ start: 0, end: full.length }] };
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
              onClick={() => handlers.onExtract?.(pickExtractPayload())}
              title="就此另立一条子摘录（正文里选中哪段就摘哪段、并记下它在本卡里的位置；未选中＝整条）"
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
            <button
              disabled={busy}
              onClick={() => handlers.onJumpToSource?.()}
              title={
                extract.contextRef?.parentExtractId
                  ? "回到父摘录卡片，并高亮这条子摘录所引的那一段（不推进调度）"
                  : "跳回材料中的原位置（不写入阅读进度）"
              }
            >
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
