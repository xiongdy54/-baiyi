// 直角下拉菜单（瑞士风：paper 底 + hairline + 直角 + hover grey-1；替换原生 select 的圆角弹层）
// v19 起为共享组件（原 dashboard 专属）；align 控制弹出菜单对齐：right=右缘对齐（仪表盘默认），left=左缘对齐（AI 侧栏等左侧控件用）
import { useEffect, useRef, useState } from "react";
import { IconChevronDown } from "./icons";

export interface DropdownOption {
  value: string;
  label: string;
}

interface Props {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  title?: string;
  align?: "left" | "right";
}

export default function Dropdown({ value, options, onChange, title, align = "right" }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
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
        onClick={() => setOpen((v) => !v)}
      >
        {current?.label ?? value}
        <IconChevronDown size={12} className="dd-caret" />
      </button>
      {open && (
        <div className={`dd-menu${align === "left" ? " dd-menu-left" : ""}`} role="listbox">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              className={`dd-item${o.value === value ? " dd-item-on" : ""}`}
              onClick={() => { setOpen(false); if (o.value !== value) onChange(o.value); }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
