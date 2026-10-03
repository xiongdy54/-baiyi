// 选区菜单（批 4 Task 9，规格 §3.3；v48.41/D81 动作上移工具栏；v48.43/D83 菜单只留**批注框+色块**）：
// 模式段控（高亮 ｜ 摘录+高亮）与形式段控（高亮 ｜ 下划线）上移宿主工具栏（.reader-sel-actions /
// .extract-toolbar，批注栏头段控同款样式）。菜单＝色块上方的**批注文本框**（每次选区重置）+ 调色排——
// 点色时有文字＝批注一并保存；无文字＝无批注的高亮或摘录。点色**不再自动弹编辑浮层**（编辑走
// 栏内条目/文中标记点击，R37/R40 入口不变）。
// 定位一律走 src/lib/popoverPlace.ts（R22：锚点＝**选区包围盒**，不再用 pointerup 坐标）。
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { placePopover, type PopoverRect } from "../lib/popoverPlace";

/** 批注色板 id（规格 §2）：渲染取 --annot-<name>；颜色不承载调度语义 */
export const ANNOT_COLORS = ["red", "orange", "yellow", "green", "teal", "blue", "purple", "magenta"] as const;
export type AnnotColor = (typeof ANNOT_COLORS)[number];

/**
 * 标注模式（R38）：`highlight`＝纯批注（不进队列）；`extract`＝摘录+高亮（进队列）。
 * 标记形式（v48.41/D81）：`highlight`＝底色高亮；`underline`＝批注色下划线（透明底）。
 * 两者已上移宿主工具栏（D83），菜单不再渲染段控。
 */
export type AnnotMenuMode = "highlight" | "extract";
export type AnnotMarkForm = "highlight" | "underline";
export type AnnotMode = AnnotMarkForm;

export interface SelectionMenuAction {
  key: string;
  label: string;
  onClick: () => void;
}

export default function SelectionMenu({
  anchor,
  container,
  colors,
  onPick,
  byLocked = false
}: {
  /** 选区包围盒（视口坐标）——R22 判据 4 */
  anchor: PopoverRect;
  /** 阅读容器（视口坐标；菜单夹在它内部，含 8px 边距） */
  container?: PopoverRect | null;
  /** 用户配好的色板（设置键 annotatePalette）；空则不渲染调色排 */
  colors: readonly AnnotColor[];
  /** 点色＝按工具栏当前模式与形式完成标注；第二参＝菜单批注框的文字（空串＝无批注） */
  onPick: (color: AnnotColor, comment: string) => void;
  /**
   * 多段选择修饰键按住期间置位：菜单**让路**——整块 pointer-events:none，
   * 好让「按住 Ctrl 拖选下一段」的起笔落在正文而不是菜单上。
   */
  byLocked?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  // 批注草稿：随选区（锚点）更换即重置——菜单是「这一次标注」的一次性面板
  const [comment, setComment] = useState("");
  useEffect(() => {
    setComment("");
  }, [anchor.x, anchor.y, anchor.width, anchor.height]);

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
  }, [anchor.x, anchor.y, anchor.width, anchor.height, container?.x, container?.y, container?.width, container?.height, colors.length]);

  return (
    <div
      ref={ref}
      className={`menu selection-menu${byLocked ? " menu-locked" : ""}`}
      role="dialog"
      aria-label="选中文字"
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 }}
    >
      <div className="mrow">
        <textarea
          className="menu-comment"
          rows={2}
          placeholder="批注（可留空）"
          aria-label="批注内容"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
        {colors.length > 0 && (
          <div className="swatches">
            {colors.map((c) => (
              <button
                key={c}
                type="button"
                className="swatch"
                data-color={c}
                title="用这支色完成本次标注（附上方批注，如有）"
                aria-label={`标注色 ${c}`}
                style={{ background: `var(--annot-${c})` }}
                onClick={() => onPick(c, comment.trim())}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
