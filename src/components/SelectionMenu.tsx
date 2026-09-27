// 选区菜单（批 4 Task 9，规格 §3.3 / R38 重排）：两行面板。
// 第一行＝模式段控（高亮 ｜ 摘录+高亮，互斥，状态持久）+ 调色排（点色即完成当前模式的动作）；
// 第二行＝既有动作（制卡 / AI 制卡 / AI 解释 / 摘录 / 查词 / 图片挖空）。
// 定位一律走 src/lib/popoverPlace.ts（R22：锚点＝**选区包围盒**，不再用 pointerup 坐标）。
// 类名与尺寸照 design-samples/annotation-two-modes.html（.menu/.mrow/.seg/.swatches/.swatch/.macts）。
import { useLayoutEffect, useRef, useState } from "react";
import { placePopover, type PopoverRect } from "../lib/popoverPlace";

/** 批注色板 id（规格 §2）：渲染取 --annot-<name>；颜色不承载调度语义 */
export const ANNOT_COLORS = ["red", "orange", "yellow", "green", "teal", "blue", "purple", "magenta"] as const;
export type AnnotColor = (typeof ANNOT_COLORS)[number];

export type AnnotMode = "highlight" | "extract";

export interface SelectionMenuAction {
  key: string;
  label: string;
  onClick: () => void;
}

export default function SelectionMenu({
  anchor,
  container,
  mode,
  onModeChange,
  colors,
  onPick,
  actions,
  byLocked = false
}: {
  /** 选区包围盒（视口坐标）——R22 判据 4 */
  anchor: PopoverRect;
  /** 阅读容器（视口坐标；菜单夹在它内部，含 8px 边距） */
  container?: PopoverRect | null;
  mode: AnnotMode;
  onModeChange: (m: AnnotMode) => void;
  /** 用户配好的色板（设置键 annotatePalette）；空则不渲染调色排 */
  colors: readonly AnnotColor[];
  /** 点色＝完成当前模式的动作（颜色不记：每次选色都是一次明确动作） */
  onPick: (color: AnnotColor) => void;
  /** 第二行既有动作（宿主给，顺序即显示顺序） */
  actions: SelectionMenuAction[];
  /**
   * 多段选择修饰键按住期间置位：菜单**让路**——整块 pointer-events:none，
   * 好让「按住 Ctrl 拖选下一段」的起笔落在正文而不是菜单上。
   * 起因（实测）：两行菜单高 79px，按 R22 落在选区下方时会盖住**下一行**的拖选线
   * （multiselect.gui 实测菜单 y 195–274 盖住第二段 y=267）——不给让路则该套件 6 条判据全红。
   */
  byLocked?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 先渲染在视口外一帧等测量（left:-9999），再按实测尺寸算位置——避免首帧闪到错误位置
    const { left, top } = placePopover({
      anchor,
      container,
      size: { width: el.offsetWidth, height: el.offsetHeight },
      prefer: "auto"
    });
    setPos({ left, top });
  }, [anchor.x, anchor.y, anchor.width, anchor.height, container?.x, container?.y, container?.width, container?.height, mode, colors.length, actions.length]);

  return (
    <div
      ref={ref}
      className={`menu selection-menu${byLocked ? " menu-locked" : ""}`}
      role="dialog"
      aria-label="选中文字"
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 }}
    >
      <div className="mrow">
        <div className="seg" role="tablist" aria-label="标注模式">
          {([["highlight", "高亮"], ["extract", "摘录+高亮"]] as const).map(([val, label]) => (
            <button
              key={val}
              type="button"
              role="tab"
              className={mode === val ? "on" : undefined}
              aria-selected={mode === val}
              onClick={() => onModeChange(val)}
            >
              {label}
            </button>
          ))}
        </div>
        {colors.length > 0 && (
          <div className="swatches">
            {colors.map((c) => (
              <button
                key={c}
                type="button"
                className="swatch"
                data-color={c}
                title="用这支色完成当前模式的操作"
                aria-label={`标注色 ${c}`}
                style={{ background: `var(--annot-${c})` }}
                onClick={() => onPick(c)}
              />
            ))}
          </div>
        )}
      </div>
      <div className="macts">
        {actions.map((a) => (
          <button key={a.key} type="button" onClick={a.onClick}>
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
