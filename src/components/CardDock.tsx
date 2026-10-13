// 制卡台容器（v48.101 / D146 修订，基础结构＝v48.100 / D144 #2 IA 重设计，取代 v48.79 / D123 的「手动区 + AI 区」两段式）
// 结构：上＝制卡板块（头行 34px：页签「手动制卡｜AI 制卡」平分整行 + 右端收起箭头（沿用 D123
//       manualCollapsed 收合机制，语义＝「制卡板块收起」；v48.101：头行左侧「制卡」题字钮退役）；
//       两页签体常驻挂载、display:none 切换保活——表单草稿 / AI 面板 / 流式状态跨页签不丢）；
//       下＝解释板块（开合把手 20px + .collapse-clip 内容槽 + 悬浮按钮行槽 + composer 槽；
//       默认收起＝仅按钮行 + 输入条，无既有内容时把手不在场；发送/内容到达自动展开经
//       useSelectionActions 的 explainOpen 通道接线，D144 #3）。
// 入口只有顶栏「制卡台」按钮（宿主经 wb:toggle 事件开合）；本组件无「＋制卡」大钮、关闭钮、右缘把手，
// 也没有任何闪烁/呼吸动画。
// 放置：right（默认，右侧固定）/ bottom（底部固定，制卡板块左 解释板块右）/ window（独立窗口：占满、不推让不外延）。
// 推让与窗口外延由 workbenchLayout 仲裁（本组件只登记展开态）。
import { useEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { IconChevronDown, IconChevronRight } from "./icons";
import { isDockLayoutApplied, setDockLayout, type WorkbenchDockPlacement } from "../lib/workbenchLayout";

/** 制卡板块页签（D144）：manual＝手动制卡表单；aicards＝自由材料 / AI 制卡草稿面板 */
export type CardsTab = "manual" | "aicards";

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
  aicards,
  explainOpen,
  onToggleExplain,
  explainHandleVisible,
  explainBody,
  explainModeBar,
  explainComposer
}: {
  /** 制卡板块活动页签（显式点击 > 内容派生，派生桥接在宿主 SelectionPanels） */
  tab: CardsTab;
  onTabChange: (tab: CardsTab) => void;
  placement: WorkbenchDockPlacement;
  dockOpen: boolean;
  /** 制卡板块是否收起为仅头行（页签体仍挂载，草稿保留）——沿用 D123 manualCollapsed 机制语义 */
  manualCollapsed: boolean;
  onToggleManual: () => void;
  /** 收起整个制卡台（Esc；状态保留，再按顶栏按钮展开） */
  onCollapse: () => void;
  /** 手动制卡页签体（常驻保活） */
  manual: ReactNode;
  /** 题型页签（驻「手动制卡」页签体顶部，D144：头行只留板块页签） */
  manualTabs?: ReactNode;
  /** AI 制卡页签体（常驻保活） */
  aicards: ReactNode;
  /** 解释板块开态（默认收起；发送/内容到达自动展开经 useSelectionActions explainOpen 接线，D144 #3） */
  explainOpen: boolean;
  onToggleExplain: () => void;
  /** 把手显隐：仅有解释内容或已展开时在场（D144 §2.1） */
  explainHandleVisible: boolean;
  /** 解释内容槽（展开态滚动区：引用块/答案/追问线程） */
  explainBody: ReactNode;
  /** 悬浮按钮行槽（ExplainModeBar 四 ghost 钮，D144 #3 换装完成） */
  explainModeBar?: ReactNode;
  /** composer 槽（wb-composer testid 保留） */
  explainComposer: ReactNode;
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
      {/* 制卡板块（D144）：头行＝页签（手动制卡｜AI 制卡，平分整行）+ 右端收起箭头。
          v48.101（D146）：头行左侧「制卡」题字钮退役（与顶栏入口重复命名；开合收归右端箭头单钮） */}
      <section className={`wb-manual${manualCollapsed ? " is-collapsed" : ""}`} data-testid="wb-cards" aria-label="制卡">
        <header className="wb-head">
          <div className="dock-tabs" role="tablist" aria-label="制卡页签" data-testid="wb-cards-tabs">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "manual"}
              className={tab === "manual" ? "on" : undefined}
              data-testid="wb-tab-manual"
              onClick={() => onTabChange("manual")}
            >
              手动制卡
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "aicards"}
              className={tab === "aicards" ? "on" : undefined}
              data-testid="wb-tab-aicards"
              onClick={() => onTabChange("aicards")}
            >
              AI 制卡
            </button>
          </div>
          <button
            type="button"
            className="wb-chev-btn"
            aria-label={manualCollapsed ? "展开制卡板块" : "收起制卡板块"}
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
        {/* 收起/展开同一套 collapse-clip（grid 0fr↔1fr）：两个方向都有过渡；页签体保持挂载，收起态 visibility 延后隐藏 */}
        <div className={`collapse-clip wb-manual-clip${manualCollapsed ? "" : " is-open"}`} aria-hidden={manualCollapsed}>
          <div className="collapse-inner">
            {/* 两页签体常驻挂载、display:none 切换保活（D144 §4.1：内容无损） */}
            <div className="wb-cards-tabbody" data-wb-tabbody="manual" style={tab === "manual" ? undefined : { display: "none" }}>
              {manualTabs && <div className="wb-cards-modes">{manualTabs}</div>}
              <div className="wb-manual-body" data-testid="wb-manual-body">
                {manual}
              </div>
            </div>
            <div className="wb-cards-tabbody" data-wb-tabbody="aicards" style={tab === "aicards" ? undefined : { display: "none" }}>
              {aicards}
            </div>
          </div>
        </div>
      </section>
      {/* 解释板块（D144）：恒在坞底；收起态仅按钮行 + 输入条，把手仅在有内容或已展开时在场 */}
      <section className="wb-explain" data-testid="wb-explain" aria-label="AI 解释">
        {explainHandleVisible && (
          <button
            type="button"
            className="wb-explain-toggle"
            data-testid="wb-explain-toggle"
            aria-expanded={explainOpen}
            title={explainOpen ? "收起解释" : "展开解释"}
            onClick={onToggleExplain}
          >
            {/* v48.101（D146）：箭头随几何方向——收起态（内容将向上展开）＝向上箭头；展开态（将向下收起）＝向下箭头 */}
            <IconChevronDown size={14} className={explainOpen ? undefined : "is-flip"} />
          </button>
        )}
        {/* 内容槽走 .collapse-clip 通用折叠（grid 0fr↔1fr）；收起态 visibility 延后隐藏（防 Tab 进入） */}
        <div className={`collapse-clip wb-explain-clip${explainOpen ? " is-open" : ""}`} aria-hidden={!explainOpen}>
          <div className="collapse-inner">
            <div className="wb-explain-body" data-testid="wb-explain-body">
              {explainBody}
            </div>
          </div>
        </div>
        {/* 悬浮按钮行槽：ExplainModeBar 四 ghost 钮（§4.3 语义矩阵在宿主 SelectionPanels） */}
        <div className="wb-mode-bar" data-testid="wb-mode-bar">
          {explainModeBar}
        </div>
        {explainComposer}
      </section>
    </aside>
  );
}
