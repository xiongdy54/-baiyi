// BackgroundActivity——右下角全局后台任务指示器（v48.13 起，v48.17 改多任务容器 / D53）。
//
// 定位（§4.19 v48.13 收口块 ⑥「入口与呈现」；此处原文标注的「4.19 第 12 项」是悬空引用——那一项是「合规」）：它不是「导图工作区的进度条」，而是**整个软件的后台活动状态标记**。
// 生成任务由主进程持有，用户在正文/其他界面时它照常推进；本组件只订阅全局广播并如实呈现。
//
// v48.17 版式 D（用户从四版样张里选的，见 design-samples/bg-activity-expand.html）：
//   ● 一个盒子：收起态 = 一行（最新那条），hover / 键盘 focus 就地**向上、向左**长成详情卡
//     （底边与右边钉死，所以只会向上和向左长）。
//   ● **一任务一行、各自单独关闭**；全部关完整个浮窗消失。原先一次只显示一条，
//     库里多条历史运行时用户看到的就是「关闭要点两次」——列出来就不再有这个歧义。
//   ● 行序：最新那条在**最下一行**（收起态那一行的内容/位置与它一致），每行的详情长在它**下方**
//     → 阅读顺序是 书名行 → 详情 → 按钮。
//   ● 行上常驻**书名**：多任务同时在场时，「这条详情属于哪本书」不能靠 hover 猜。
//
// 两条不可破坏的几何恒等式（改动前请先实测，别照抄注释）：
//   ① 详情块**定高** → 切换展开行时卡片总高不变、顶边不动；否则顶边会带着整块位移，
//      光标被甩到卡片外触发 mouseleave 自动收起（用户实测报过这个抖动）。
//   ② 收起态只剩**一行**：非最新的行、行分隔线、「另有 N 项」那行都要一并藏掉。
//
// 视觉（Swiss / International Typographic Style，§4.19-9）：单一 accent、灰阶面、无渐变、
// 无大圆角（--radius: 0）、全应用唯一允许的 shadow-float、12px metadata、8px 间距基线、
// 单一功能动效且尊重 prefers-reduced-motion。

import { useCallback, useEffect, useRef, useState } from "react";
import { mindmapApi } from "../lib/mindmap";
import { describeTask, dismissTask, listTasks, subscribe, type ActivityTask } from "../lib/activity";
import { rememberDismissed } from "../lib/activityDismiss";

/** 超过这个条数就折到「另有 N 项」后面（卡片高度 = 24×N + 120，不封顶会顶出屏幕） */
const ROW_CAP = 8;

interface BackgroundActivityProps {
  /**
   * 打开某份材料的导图（由 App 负责导航：必要时先进入阅读器）。
   * mapId = 要展示的版本——候选版本按发布模型不激活，但用户点「打开导图」就该看到刚生成的那一版。
   */
  onOpenMap: (documentId: string, mapId?: string | null, resumeRunId?: string | null) => void;
}

export function BackgroundActivity({ onOpenMap }: BackgroundActivityProps) {
  const [tasks, setTasks] = useState<ActivityTask[]>(() => listTasks());
  const [expanded, setExpanded] = useState(false); // 整卡是否展开（收起态只有一行）
  const [openId, setOpenId] = useState<string | null>(null); // 哪一行摊开详情（同一时刻只有一行）
  const [pinned, setPinned] = useState(false); // 点击/键盘展开后不因移开鼠标而收起
  const [showAll, setShowAll] = useState(false); // 「另有 N 项」被点开
  const rootRef = useRef<HTMLDivElement | null>(null);
  const collapseTimer = useRef<number | null>(null);

  useEffect(() => subscribe(() => setTasks(listTasks())), []);

  // 队列变了（新增/被关掉一条）就别让「全展开」状态悬着：封顶口径以当前条数为准
  useEffect(() => setShowAll(false), [tasks.length]);

  // 展开后 Esc 收起；收起态不抢占焦点
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setExpanded(false);
        setOpenId(null);
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

  const collapse = useCallback(() => {
    if (pinned) return;
    // 留一点延时：快速划过边缘时不要一闪即收（卡片本身无空隙，空隙是历史遗留）
    collapseTimer.current = window.setTimeout(() => {
      const root = rootRef.current;
      if (root && root.matches(":hover")) return;
      if (root && root.contains(document.activeElement)) return;
      setExpanded(false);
      setOpenId(null);
    }, 160);
  }, [pinned]);

  useEffect(() => () => cancelCollapse(), [cancelCollapse]);

  // describeTask 对未知阶段返回 null → 那条**不显示**，而不是编个状态出来（收口块 ⑥ 的既有兜底）
  const rows = tasks.flatMap((t) => {
    const v = describeTask(t);
    return v ? [{ t, v }] : [];
  });
  if (!rows.length) return null;

  // listTasks() 已按 updatedAt 升序 → 最后一条是最新的那条，收起态显示它，并排在卡片最下一行
  const primaryId = rows[rows.length - 1].t.runId;
  const shown = showAll || rows.length <= ROW_CAP ? rows : rows.slice(rows.length - ROW_CAP);
  const hiddenCount = rows.length - shown.length;

  const openRow = (runId: string) => {
    cancelCollapse();
    setExpanded(true);
    setOpenId(runId);
  };

  /** 处置掉一条提示：内存里删掉 + 记进持久化清单，下次启动播种不再出现（v48.17 D53） */
  const dispose = (runId: string) => {
    rememberDismissed(runId);
    dismissTask(runId);
    setOpenId((cur) => (cur === runId ? null : cur));
  };

  const openMap = (runId: string, documentId: string | null, mapId: string | null, phase: string) => {
    if (!documentId) return;
    // v48.13 P3：被应用关闭打断的 run → 打开导图的同时续跑（同 runId，缓存命中、零重复计费）；
    // 首层就绪的 run 不自动续跑——按需深化由用户点具体节点决定。
    onOpenMap(documentId, mapId, phase === "interrupted" ? runId : null);
    // 用户已经去看图了，这条提示的使命就结束了（仍在运行的除外：那时用户要的是看得见的进度）
    if (phase !== "running") dispose(runId);
  };

  return (
    <div
      ref={rootRef}
      className={`bg-activity${expanded ? " is-expanded" : ""}`}
      onMouseEnter={() => {
        cancelCollapse();
        setExpanded(true);
      }}
      onMouseLeave={collapse}
      onFocus={(e) => {
        cancelCollapse();
        setExpanded(true);
        const runId = (e.target as HTMLElement).closest?.(".bg-activity-task")?.getAttribute("data-run");
        if (runId) setOpenId(runId);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setPinned(false);
          collapse();
        }
      }}
    >
      <div className="bg-activity-card" role="status" aria-live="polite">
        {hiddenCount > 0 && (
          <button type="button" className="bg-activity-more" onClick={() => setShowAll(true)}>
            另有 {hiddenCount} 项 · 点此全展开
          </button>
        )}
        {shown.map(({ t, v }) => {
          const isOpen = openId === t.runId;
          const isPrimary = t.runId === primaryId;
          return (
            <div
              key={t.runId}
              data-run={t.runId}
              className={`bg-activity-task tone-${v.tone}${isPrimary ? " is-primary" : ""}${isOpen ? " is-expanded" : ""}`}
              onMouseEnter={() => setOpenId(t.runId)}
            >
              {/* 书名行：收起态只有这一行；位置在卡片最末行（版式 D：最新那条 = 收起态那条） */}
              <button
                type="button"
                className="bg-activity-row"
                aria-expanded={isOpen}
                title={`${v.heading} — ${v.short}`}
                onClick={() => {
                  if (isOpen && pinned) {
                    setPinned(false);
                    setOpenId(null);
                  } else {
                    openRow(t.runId);
                    setPinned(true);
                  }
                }}
              >
                <span className="bg-activity-dot" aria-hidden="true" />
                <span className="bg-activity-meta">
                  <span className="bg-activity-title">{v.heading}</span>
                  <span className="bg-activity-vr" aria-hidden="true" />
                  <span className="bg-activity-text">{v.short}</span>
                </span>
                {isPrimary && rows.length > 1 && <span className="bg-activity-count">· 共 {rows.length} 项</span>}
              </button>

              {/* 详情块：**定高**（恒等式①）——切行时卡片总高不变，光标不会被甩出去 */}
              <div className="bg-activity-extra">
                <div className="bg-activity-extra-in">
                  <p className="bg-activity-detail">{v.detail}</p>
                  <div className={`bg-activity-bar${v.percent === null ? " is-unknown" : ""}`} aria-hidden="true">
                    {v.percent !== null && <span style={{ width: `${v.percent}%` }} />}
                  </div>
                  <div className="bg-activity-actions">
                    {v.canOpen && (
                      <button
                        type="button"
                        className="bg-activity-btn is-primary"
                        onClick={() => openMap(t.runId, t.documentId, t.mapId, t.phase)}
                      >
                        打开导图
                      </button>
                    )}
                    {/* 只有**正在跑**的才谈得上取消：被中断/首层就绪的 run 已不在运行，给「取消」是假动作 */}
                    {t.phase === "running" && (
                      <button type="button" className="bg-activity-btn" onClick={() => void mindmapApi.cancel(t.runId)}>
                        取消任务
                      </button>
                    )}
                    <button type="button" className="bg-activity-btn" onClick={() => dispose(t.runId)}>
                      关闭
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {showAll && rows.length > ROW_CAP && (
          <button type="button" className="bg-activity-more" onClick={() => setShowAll(false)}>
            收起，只看最新 {ROW_CAP} 项
          </button>
        )}
      </div>
    </div>
  );
}
