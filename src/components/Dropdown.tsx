// 直角下拉菜单（瑞士风：paper 底 + hairline + 直角 + hover grey-1；替换原生 select 的圆角弹层）
// v19 起为共享组件（原 dashboard 专属）；align 控制弹出菜单对齐：right=右缘对齐（仪表盘默认），left=左缘对齐（AI 侧栏等左侧控件用）
// v48.80（D124 / 设计稿 §11.4）：multiple 多选模式——点击项只切换选中态、不收起菜单（轨道「归入…」一次勾选多条）；
// onClose 在菜单收起时回调（收起后再刷新）；option 支持 disabled（无语言信息的轨道禁选「语言习得」）。
import { useEffect, useRef, useState } from "react";
import { IconChevronDown } from "./icons";

export interface DropdownOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface Props {
  value: string;
  options: DropdownOption[];
  /** 单选模式必传；多选模式用 onToggle 代替 */
  onChange?: (value: string) => void;
  title?: string;
  align?: "left" | "right";
  /** 多选模式：选中态取 selectedValues，点击项触发 onToggle 且不收起菜单 */
  multiple?: boolean;
  selectedValues?: string[];
  onToggle?: (value: string) => void;
  /** 菜单收起时回调（点击项 / 点外部 / 再点按钮三条路径都走这里） */
  onClose?: () => void;
  /** 按钮无选中项时的占位文字（多选模式恒显示它） */
  placeholder?: string;
}

export default function Dropdown({
  value,
  options,
  onChange,
  title,
  align = "right",
  multiple = false,
  selectedValues,
  onToggle,
  onClose,
  placeholder
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);
  const selected = new Set(selectedValues || []);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  function close() {
    setOpen(false);
    onCloseRef.current?.();
  }

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div className="dd" ref={ref}>
      <button
        type="button"
        className="dd-btn"
        title={title}
        onClick={() => (open ? close() : setOpen(true))}
      >
        {current?.label ?? placeholder ?? value}
        <IconChevronDown size={12} className="dd-caret" />
      </button>
      {open && (
        <div className={`dd-menu${align === "left" ? " dd-menu-left" : ""}`} data-ui="menu" role="listbox">
          {options.map((o) => {
            const on = multiple ? selected.has(o.value) : o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={on}
                disabled={o.disabled}
                className={`dd-item${on ? " dd-item-on" : ""}`}
                onClick={() => {
                  if (o.disabled) return;
                  if (multiple) {
                    onToggle?.(o.value);
                    return;
                  }
                  close();
                  if (o.value !== value) onChange?.(o.value);
                }}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
