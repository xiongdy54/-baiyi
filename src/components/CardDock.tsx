// 学习坞（v48.52 / D92）：右侧常驻坞容器——双页签（AI 解释｜AI 制卡）+「＋制卡」主按钮
// + 收起/展开 + 关闭。D88 的纯容器升级：坞体在 dockOpen=false 时 translateX 滑出视口（收起≠关闭，
// 状态保留），右缘渲染常驻细把手（AI 流式＝呼吸点、手动草稿在场＝墨点）；关闭（data-dock-close）
// 语义由宿主决定（AI 态含批次 reject、手动态 closeManual），本组件只回调。
// Esc 仅手动态（承接原模态 useDialogA11y 的 Esc 语义）、手动态挂载后自动聚焦——沿用 D88 行为。
import { useEffect, useRef, type ReactNode } from "react";
import { IconChevronLeft, IconChevronRight, IconClose } from "./icons";

export type DockTab = "explain" | "cards";

export default function CardDock({
  mode,
  tab,
  onTabChange,
  meta,
  manualActive = false,
  onManual,
  streaming = false,
  manualDraft = false,
  dockOpen,
  onCollapse,
  onExpand,
  onClose,
  children
}: {
  /** manual＝手动暂态占坞体（Esc/自动聚焦挂这态）；ai＝页签体 */
  mode: "manual" | "ai";
  /** 活动页签（D92 §3.2：显式点击 > 内容派生，派生在宿主） */
  tab: DockTab;
  onTabChange: (tab: DockTab) => void;
  /** 头行 meta（mono）：《材料名》——有则显，flex 收缩省略号（空间不足允许被压缩） */
  meta?: string;
  /** 手动暂态占坞体中（「＋制卡」呈 active 态指示草稿在场，两页签皆非激活） */
  manualActive?: boolean;
  /** 「＋制卡」全局手动制卡入口（免选区＝空表单；有选区＝quote 预填，宿主同链路） */
  onManual: () => void;
  /** AI 流式中（把手呼吸点） */
  streaming?: boolean;
  /** 手动草稿在场（把手墨点） */
  manualDraft?: boolean;
  /** 展开/收起（收起＝坞体滑出、状态保留；关闭才卸载） */
  dockOpen: boolean;
  onCollapse: () => void;
  onExpand: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  // onClose 每次渲染都是新身份；Esc 监听只挂一次，经 ref 读最新回调（dialogA11y 同款手法）
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  // Esc 关闭＝手动态既有模态语义（原 useDialogA11y 承担）；AI 态现状本无 Esc 关闭，不擅自扩
  useEffect(() => {
    if (mode !== "manual" || !dockOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, dockOpen]);

  // 「点开即可打字」（D88 §15 注记）：手动暂态占坞后显式把焦点交给第一个可输入字段
  // （AI 态不自动抢焦点——现状 AIPanel 也从不自动聚焦）
  useEffect(() => {
    if (mode !== "manual") return;
    const t = window.setTimeout(() => {
      const first = bodyRef.current?.querySelector("textarea, input:not([type=checkbox]), input[type=range]");
      (first as HTMLElement | null)?.focus();
    }, 0);
    return () => window.clearTimeout(t);
  }, [mode]);

  return (
    <>
      <aside
        className={`side-dock card-dock${dockOpen ? "" : " is-collapsed"}`}
        data-card-dock
        data-dock-collapsed={dockOpen ? undefined : "1"}
        role="complementary"
        aria-label="学习坞"
        aria-hidden={!dockOpen}
      >
        <div className="side-dock-head">
          <div className="dock-tabs" role="tablist" aria-label="学习坞页签" data-testid="dock-tabs">
            <button
              type="button"
              role="tab"
              aria-selected={!manualActive && tab === "explain"}
              className={!manualActive && tab === "explain" ? "on" : undefined}
              data-testid="dock-tab-explain"
              onClick={() => onTabChange("explain")}
            >
              AI 解释
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={!manualActive && tab === "cards"}
              className={!manualActive && tab === "cards" ? "on" : undefined}
              data-testid="dock-tab-cards"
              onClick={() => onTabChange("cards")}
            >
              AI 制卡
            </button>
          </div>
          {meta ? <span className="side-dock-meta mono">《{meta}》</span> : null}
          <button
            type="button"
            className={`btn btn-primary btn-sm dock-manual-btn${manualActive ? " on" : ""}`}
            data-testid="dock-manual"
            aria-pressed={manualActive}
            title="手动制卡（免选区自由制卡；有选区自动预填引用）"
            onClick={onManual}
          >
            ＋制卡
          </button>
          <button
            type="button"
            className="icon-btn side-dock-collapse"
            data-testid="dock-collapse"
            aria-expanded={dockOpen}
            aria-controls="learn-dock-body"
            title={dockOpen ? "收起（保留内容与草稿）" : "展开"}
            onClick={onCollapse}
          >
            <IconChevronRight size={16} />
          </button>
          <button type="button" className="icon-btn side-dock-close" data-dock-close aria-label="关闭面板" title="关闭" onClick={onClose}>
            <IconClose size={16} />
          </button>
        </div>
        <div ref={bodyRef} id="learn-dock-body" className={`side-dock-body${mode === "manual" ? " side-dock-body-manual" : ""}`}>
          {children}
        </div>
      </aside>
      {/* 收起后的常驻细把手（~40px 竖条，不进正文版心）：点按展开；状态点告知「里面还有活」 */}
      {!dockOpen && (
        <button
          type="button"
          className="dock-handle"
          data-testid="dock-handle"
          aria-expanded={false}
          aria-controls="learn-dock-body"
          title="展开学习坞"
          onClick={onExpand}
        >
          <IconChevronLeft size={16} />
          {streaming && <i className="dock-handle-dot is-live" aria-hidden="true" />}
          {manualDraft && <i className="dock-handle-dot is-draft" aria-hidden="true" />}
        </button>
      )}
    </>
  );
}
