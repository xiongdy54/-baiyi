// 坞内三按钮选单（v48.100，D144 #5，方案 §4.4/§3.3）：解释板块内容区选中文字后的一行三文字钮
// 浮条「AI 制卡｜复制｜引用」。视觉复用 .menu selection-menu 浮条语法（paper + hairline +
// --shadow-float，D122）+ .sel-btn 加高 28px 变体；定位复用 src/lib/popoverPlace.ts（D122 同一
// 函数：锚＝选区包围盒，默认在选区上方、放不下自动翻到下方——与 SelectionMenu 同一函数同一手法）。
// 交互合同（§4.4）：点钮不夺走正文选区（onMouseDown preventDefault，SelectionMenu 既有手法）；
// 关闭（执行任一动作 / Esc / 点击选单外 / 选区坍塌）由宿主 SelectionPanels 监听承接——本组件
// 保持纯展示 + 三动作回调的可复用形态（§6：坞内实例 + 全局覆盖窗口复用同一视觉规格）。
// DOM 契约（§10）：.dock-trio + 每钮 data-trio-act="aiCards|copy|quote"。
import { useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { placePopover, type PopoverRect } from "../lib/popoverPlace";

export function DockTrioMenu({
  anchor,
  container,
  text,
  onAiCards,
  onCopy,
  onQuote
}: {
  /** 选区包围盒（视口坐标；§4.4 判据＝锚，不用 pointerup 点） */
  anchor: PopoverRect;
  /** 可用容器（视口坐标；缺省＝整个视口） */
  container?: PopoverRect | null;
  /** 选中文本（三动作共用同一原文；trim 由动作者侧决定） */
  text: string;
  onAiCards: (text: string) => void;
  onCopy: (text: string) => void;
  onQuote: (text: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; placement: "above" | "below" } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 先渲染在视口外一帧等测量（SelectionMenu 同一手法），再按实测尺寸算位置
    const r = placePopover({
      anchor,
      container,
      size: { width: el.offsetWidth, height: el.offsetHeight },
      prefer: "above"
    });
    setPos((p) =>
      p && p.left === r.left && p.top === r.top && p.placement === r.placement
        ? p
        : { left: r.left, top: r.top, placement: r.placement }
    );
  }, [anchor.x, anchor.y, anchor.width, anchor.height, container?.x, container?.y, container?.width, container?.height]);
  // 点钮不夺走正文选区（SelectionMenu 既有手法）：选区保持在场，动作读取后由宿主关闭选单
  const keepSel = (e: ReactMouseEvent) => e.preventDefault();
  return (
    <div
      ref={ref}
      className="menu selection-menu dock-trio"
      data-place={pos?.placement ?? "above"}
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 }}
    >
      <div className="sel-row">
        <button type="button" className="sel-btn" data-trio-act="aiCards" title="交给 AI 制卡" onMouseDown={keepSel} onClick={() => onAiCards(text)}>
          AI 制卡
        </button>
        <button type="button" className="sel-btn" data-trio-act="copy" title="复制到手动制卡文本框" onMouseDown={keepSel} onClick={() => onCopy(text)}>
          复制
        </button>
        <button type="button" className="sel-btn" data-trio-act="quote" title="引用到 AI 解释输入框" onMouseDown={keepSel} onClick={() => onQuote(text)}>
          引用
        </button>
      </div>
    </div>
  );
}
