import { useState } from "react";
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

export interface ExtractFaceHandlers {
  onAdvance: () => void;
  onPostpone: (days: number) => void;
  onPriority: (priority: number) => void;
  onGraduate: () => void;
  onEdit?: (text: string) => void;
  onOpenExtract?: () => void;
  onJumpToSource?: () => void;
  onUndo?: () => void;
}

/**
 * 摘录卡面（v48.22 / D58 §6.8）：沉浸式连续处理页与复习页**共用同一组件**。
 * 正文与闪卡一样可就地编辑（EditableText）；动作集＝下一条 / 推迟 / 优先级 / 毕业 / 打开摘录 / 跳转原文。
 */
export default function ExtractCardFace({
  extract,
  madeCardCount,
  engine,
  busy,
  handlers
}: {
  extract: DueTopic;
  madeCardCount?: number;
  engine?: ExtractEngine;
  busy?: boolean;
  handlers: ExtractFaceHandlers;
}) {
  const [postponeDays, setPostponeDays] = useState(7);
  const depth = Number(extract.depth) || 1;

  return (
    <div className="extract-face">
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

      <div className="extract-face-body">
        {handlers.onEdit ? (
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

      <div className="extract-face-actions">
        <button className="primary" disabled={busy} onClick={() => handlers.onAdvance()} title="处理完这条，按 A-Factor 推进调度（空格）">
          下一条
        </button>

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
          <button disabled={busy} onClick={() => handlers.onPostpone(postponeDays)}>
            推迟
          </button>
        </span>

        <span className="extract-priority">
          <Dropdown
            value={String(extract.priority)}
            align="left"
            title="快速变更优先级（越大越靠后）"
            options={PRIORITY_OPTIONS.map((p) => ({ value: String(p), label: `优先级 ${p}` }))}
            onChange={(v) => handlers.onPriority(Number(v))}
          />
        </span>

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
        <button disabled={busy} onClick={() => handlers.onGraduate()} title="处理后认为再无值得制卡的内容：不再推送，仍保留在卡片浏览器">
          毕业
        </button>
        {handlers.onUndo && (
          <button disabled={busy} onClick={() => handlers.onUndo?.()} title="撤销最近一次操作（Z）">
            撤销
          </button>
        )}
      </div>

      {POSTPONE_PRESETS.length > 0 && (
        <div className="extract-face-hints mono">
          快捷推迟：{POSTPONE_PRESETS.map((d) => (
            <button key={d} disabled={busy} onClick={() => handlers.onPostpone(d)}>
              {d} 天
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
