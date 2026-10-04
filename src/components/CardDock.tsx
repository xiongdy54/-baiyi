// 制卡面板（D88 §8）：统一右停靠栏——手动态（ManualCardForm）与 AI 态（AIPanel 嵌入）
// 同刻只开一个（互斥由宿主 useSelectionActions 的 manualOpen / aiPanel 两状态天然保证）。
// 纯容器：几何（fixed 右缘 / 顶栏下 / 400px）、头行（标题 + meta + 关闭）、Esc（仅手动态，
// 承接原模态 useDialogA11y 的 Esc 语义）、手动态挂载后自动聚焦（「点开即可打字」，§15）。
// 表单与 AI 的状态机、落库链、批次 reject 逻辑零改动——全部留在原组件与宿主回调里。
import { useEffect, useRef, type ReactNode } from "react";
import { IconClose } from "./icons";

export default function CardDock({
  mode,
  title,
  meta,
  onClose,
  children
}: {
  /** manual＝手动态（头行挂 .side-dock-head）；ai＝AI 态（头行并挂 .ai-panel-head、
      标题并挂 .ai-panel-title——标题行自 AIPanel 并入 dock 头，既有测试钩子保留，§8.1） */
  mode: "manual" | "ai";
  /** 头行标题：手动制卡 | AI 制卡 | AI 解释 | 图片挖空（随态换文案，§8.2） */
  title: string;
  /** 头行 meta（mono）：《材料名》· 来源锚——有则显，无则省（§8.2） */
  meta?: string;
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
    if (mode !== "manual") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode]);

  // 「点开即可打字」（设计稿 §15 注记）：手动态挂载后显式把焦点交给第一个可输入字段
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
    <aside className="side-dock card-dock" data-card-dock role="complementary" aria-label="制卡面板">
      <div className={`side-dock-head${mode === "ai" ? " ai-panel-head" : ""}`}>
        <span className={`side-dock-title${mode === "ai" ? " ai-panel-title" : ""}`}>{title}</span>
        {meta ? <span className="side-dock-meta mono">《{meta}》</span> : null}
        <button type="button" className="icon-btn side-dock-close" data-dock-close aria-label="关闭面板" title="关闭" onClick={onClose}>
          <IconClose size={16} />
        </button>
      </div>
      <div ref={bodyRef} className={`side-dock-body${mode === "manual" ? " side-dock-body-manual" : ""}`}>
        {children}
      </div>
    </aside>
  );
}
