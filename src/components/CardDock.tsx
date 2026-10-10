// 制卡台容器（v48.79 / D123，取代 v48.52 / D92 的「学习坞」）
// 结构：上/左＝手动制卡区（常驻，可收起为仅标题行；表单保持挂载，草稿不丢）；
//       下/右＝AI 区（页签：解释｜制卡）。入口只有顶栏「制卡台」按钮（宿主经 wb:toggle 事件开合）；
//       本组件不再有「＋制卡」大钮、关闭钮、右缘把手，也没有任何闪烁/呼吸动画。
// 放置：right（默认，右侧固定）/ bottom（底部固定，手动左 AI 右）/ window（独立窗口：占满、不推让不外延）。
// 推让与窗口外延由 workbenchLayout 仲裁（本组件只登记展开态）。
import { useEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { IconChevronDown, IconChevronRight } from "./icons";
import { isDockLayoutApplied, setDockLayout, type WorkbenchDockPlacement } from "../lib/workbenchLayout";

export type DockTab = "explain" | "cards";

export default function CardDock({
  tab,
  onTabChange,
  placement,
  dockOpen,
  manualCollapsed,
  onToggleManual,
  onCollapse,
  manual,
  manualTabs,
  children
}: {
  /** 活动页签（显式点击 > 内容派生，派生在宿主 hook） */
  tab: DockTab;
  onTabChange: (tab: DockTab) => void;
  placement: WorkbenchDockPlacement;
  dockOpen: boolean;
  /** 手动区是否收起为仅标题行（表单仍挂载） */
  manualCollapsed: boolean;
  onToggleManual: () => void;
  /** 收起整个制卡台（Esc；状态保留，再按顶栏按钮展开） */
  onCollapse: () => void;
  /** 手动制卡表单（常驻） */
  manual: ReactNode;
  /** 手动区标题行内的题型页签（与「手动制卡」同一行） */
  manualTabs?: ReactNode;
  /** AI 页签体 */
  children: ReactNode;
}) {
  const dockRef = useRef<HTMLElement | null>(null);

  // 登记布局：展开且非独立窗口才推让/外延（串行仲裁与同步动画见 workbenchLayout）。
  // 制卡台滑动（class）与正文让位（html 数据属性）在 onCommit 内同帧提交（flushSync），时长/缓动一致。
  // 修订 7：重挂载（页面切换）时若布局本就已展开，初值即 shown——不再「先收起、再滑入」
  // 声明在布局 effect 之前：卸载时其清理先于布局 effect 的清理执行，从而让后者知道「是卸载而非开合」
  const unmountingRef = useRef(false);
  useEffect(() => {
    unmountingRef.current = false;
    return () => {
      unmountingRef.current = true;
    };
  }, []);
  const [shown, setShown] = useState(() => placement !== "window" && dockOpen && isDockLayoutApplied());
  useEffect(() => {
    if (placement === "window") {
      setShown(dockOpen);
      return;
    }
    if (!dockOpen) {
      setShown(false);
      return;
    }
    const owner = Symbol("card-dock");
    void setDockLayout(owner, true, placement, () => flushSync(() => setShown(true)));
    return () => {
      // 卸载（页面切换换宿主）给 700ms 宽限等新宿主登记；普通收起/换位置立即（0ms）
      void setDockLayout(owner, false, placement, () => flushSync(() => setShown(false)), unmountingRef.current ? 700 : 0);
    };
  }, [dockOpen, placement]);

  // Esc：焦点在制卡台内时收起（下拉菜单自己处理 Esc 时事件已被消费则不重复）
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Escape" || e.defaultPrevented || placement === "window") return;
    e.stopPropagation();
    onCollapse();
  };

  return (
    <aside
      ref={dockRef}
      className={`side-dock card-dock${shown ? "" : " is-collapsed"}`}
      data-card-dock
      data-testid="workbench-dock"
      data-placement={placement}
      data-dock-collapsed={dockOpen ? undefined : "1"}
      role="complementary"
      aria-label="制卡台"
      aria-hidden={!dockOpen}
      onKeyDown={onKeyDown}
    >
      <section className={`wb-manual${manualCollapsed ? " is-collapsed" : ""}`} data-testid="wb-manual" aria-label="手动制卡">
        <header className="wb-head">
          <button
            type="button"
            className="wb-manual-toggle"
            data-testid="wb-manual-toggle"
            aria-expanded={!manualCollapsed}
            title={manualCollapsed ? "展开手动制卡" : "收起手动制卡（草稿保留）"}
            onClick={onToggleManual}
          >
            <span className="wb-title">手动制卡</span>
          </button>
          {manualTabs}
          <button
            type="button"
            className="wb-chev-btn"
            aria-label={manualCollapsed ? "展开手动制卡" : "收起手动制卡"}
            aria-expanded={!manualCollapsed}
            onClick={onToggleManual}
          >
            {placement === "bottom" ? (
              <IconChevronRight size={14} className={manualCollapsed ? undefined : "is-flip"} />
            ) : (
              <IconChevronDown size={14} className={manualCollapsed ? undefined : "is-flip"} />
            )}
          </button>
        </header>
        {/* 收起/展开同一套 collapse-clip（grid 0fr↔1fr）：两个方向都有过渡；表单保持挂载，收起态 visibility 延后隐藏 */}
        <div className={`collapse-clip wb-manual-clip${manualCollapsed ? "" : " is-open"}`} aria-hidden={manualCollapsed}>
          <div className="collapse-inner">
            <div className="wb-manual-body" data-testid="wb-manual-body">
              {manual}
            </div>
          </div>
        </div>
      </section>
      <section className="wb-ai" aria-label="AI">
        <header className="wb-head wb-ai-head">
          <span className="wb-title">AI 助手</span>
          <div className="dock-tabs" role="tablist" aria-label="AI 页签" data-testid="dock-tabs">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "explain"}
              className={tab === "explain" ? "on" : undefined}
              data-testid="dock-tab-explain"
              onClick={() => onTabChange("explain")}
            >
              解释
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "cards"}
              className={tab === "cards" ? "on" : undefined}
              data-testid="dock-tab-cards"
              onClick={() => onTabChange("cards")}
            >
              制卡
            </button>
          </div>
        </header>
        <div id="learn-dock-body" className="wb-ai-body">
          {children}
        </div>
      </section>
    </aside>
  );
}
