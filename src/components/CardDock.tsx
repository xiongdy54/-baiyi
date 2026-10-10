// 制卡台容器（v48.79 / D123，取代 v48.52 / D92 的「学习坞」）
// 结构：上/左＝手动制卡区（常驻，可收起为仅标题行；表单保持挂载，草稿不丢）；
//       下/右＝AI 区（页签：解释｜制卡）。入口只有顶栏「制卡台」按钮（宿主经 wb:toggle 事件开合）；
//       本组件不再有「＋制卡」大钮、关闭钮、右缘把手，也没有任何闪烁/呼吸动画。
// 放置：right（默认，右侧固定）/ bottom（底部固定，手动左 AI 右）/ window（独立窗口：占满、不推让不外延）。
// 推让与窗口外延由 workbenchLayout 仲裁（本组件只登记展开态）。
import { useEffect, useRef, type ReactNode } from "react";
import { IconChevronDown, IconChevronRight } from "./icons";
import { setDockLayout, type WorkbenchDockPlacement } from "../lib/workbenchLayout";

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

  // 登记布局：展开且非独立窗口才推让/外延；卸载或收起即注销（串行仲裁见 workbenchLayout）
  useEffect(() => {
    if (placement === "window") return;
    const owner = Symbol("card-dock");
    setDockLayout(owner, dockOpen, placement);
    return () => setDockLayout(owner, false, placement);
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
      className={`side-dock card-dock${dockOpen ? "" : " is-collapsed"}`}
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
        <div className="wb-manual-body" hidden={manualCollapsed}>
          {manual}
        </div>
      </section>
      <section className="wb-ai" aria-label="AI">
        <header className="wb-head wb-ai-head">
          <span className="wb-title">AI</span>
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
