// BackgroundActivity——右下角全局后台任务指示器（v48.13，M15 批 P2）。
//
// 定位（§4.19-12）：它不是「导图工作区的进度条」，而是**整个软件的后台活动状态标记**。
// 生成任务由主进程持有，用户在正文/其他界面时它照常推进；本组件只是订阅全局广播并如实呈现：
//   ● 收起态：极小一行（默认高度 ~22px），安静、不遮挡阅读
//   ● hover / 键盘 focus 才展开详情（鼠标离开且失焦后自动收起）
//   ● 完成态点击直接打开导图
//   ● 取消只能由用户显式点击触发（离开界面永不隐式取消）
//
// 视觉（Swiss / International Typographic Style，§4.19-9）：单一 accent、灰阶面、无渐变、
// 无大圆角（--radius: 0）、全应用唯一允许的 shadow-float、12px metadata、8px 间距基线、
// 单一功能动效且尊重 prefers-reduced-motion。

import { useCallback, useEffect, useRef, useState } from "react";
import { mindmapApi } from "../lib/mindmap";
import { describeTask, dismissTask, primaryTask, subscribe, type ActivityTask } from "../lib/activity";

interface BackgroundActivityProps {
  /**
   * 打开某份材料的导图（由 App 负责导航：必要时先进入阅读器）。
   * mapId = 要展示的版本——候选版本按发布模型不激活，但用户点「打开导图」就该看到刚生成的那一版。
   */
  onOpenMap: (documentId: string, mapId?: string | null) => void;
}

export function BackgroundActivity({ onOpenMap }: BackgroundActivityProps) {
  const [task, setTask] = useState<ActivityTask | null>(() => primaryTask());
  const [expanded, setExpanded] = useState(false);
  const [pinned, setPinned] = useState(false); // 键盘展开后不因失焦/移开鼠标而收起
  const rootRef = useRef<HTMLDivElement | null>(null);
  const collapseTimer = useRef<number | null>(null);

  useEffect(() => subscribe(() => setTask(primaryTask())), []);

  // 收起态不抢占焦点；展开后 Esc 收起（键盘可达性）
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setExpanded(false);
        setPinned(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const cancelCollapse = useCallback(() => {
    if (collapseTimer.current !== null) {
      window.clearTimeout(collapseTimer.current);
      collapseTimer.current = null;
    }
  }, []);

  const scheduleCollapse = useCallback(() => {
    cancelCollapse();
    if (pinned) return;
    // 延时收起：允许鼠标从收起态移动到展开面板（两者相邻但非同一盒模型）
    collapseTimer.current = window.setTimeout(() => {
      const root = rootRef.current;
      if (root && root.matches(":hover")) return;
      if (root && root.contains(document.activeElement)) return;
      setExpanded(false);
    }, 160);
  }, [pinned, cancelCollapse]);

  useEffect(() => () => cancelCollapse(), [cancelCollapse]);

  const view = describeTask(task);
  if (!task || !view) return null;

  const openMap = () => {
    if (task.documentId) onOpenMap(task.documentId, task.mapId);
  };
  const primaryClick = () => {
    if (view.canOpen) openMap();
    else {
      setExpanded((v) => !v);
      setPinned(true);
    }
  };

  return (
    <div
      ref={rootRef}
      className={`bg-activity tone-${view.tone}${expanded ? " is-expanded" : ""}`}
      onMouseEnter={() => {
        cancelCollapse();
        setExpanded(true);
      }}
      onMouseLeave={scheduleCollapse}
      onFocus={() => {
        cancelCollapse();
        setExpanded(true);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setPinned(false);
          scheduleCollapse();
        }
      }}
    >
      {/* 展开面板（收起态不可见、不可聚焦：inert 由 CSS visibility 保证） */}
      <div className="bg-activity-panel" role="status" aria-live="polite">
        <div className="bg-activity-heading">{view.heading}</div>
        {view.detail && <div className="bg-activity-detail">{view.detail}</div>}
        {view.percent !== null && (
          <div className="bg-activity-bar" aria-hidden="true">
            <span style={{ width: `${view.percent}%` }} />
          </div>
        )}
        <div className="bg-activity-actions">
          {view.canOpen && (
            <button type="button" className="bg-activity-btn is-primary" onClick={openMap}>
              打开导图
            </button>
          )}
          {!["completed", "partial", "failed", "cancelled", "review_failed"].includes(task.phase) && (
            <button
              type="button"
              className="bg-activity-btn"
              onClick={() => {
                void mindmapApi.cancel(task.runId);
              }}
            >
              取消任务
            </button>
          )}
          <button
            type="button"
            className="bg-activity-btn"
            onClick={() => {
              setExpanded(false);
              setPinned(false);
              dismissTask(task.runId);
            }}
          >
            关闭
          </button>
        </div>
      </div>

      {/* 收起态：极小状态标记（点击 = 主操作：能打开就打开，否则展开详情） */}
      <button
        type="button"
        className="bg-activity-pill"
        onClick={primaryClick}
        aria-expanded={expanded}
        title={view.detail || view.short}
      >
        <span className="bg-activity-dot" aria-hidden="true" />
        <span className="bg-activity-text">{view.short}</span>
      </button>
    </div>
  );
}
