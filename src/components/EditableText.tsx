import { useEffect, useRef } from "react";

// 内联编辑（v11.2 重写，v48.22 从 CardBrowser 提为共享模块——复习页/摘录页/浏览器共用）：
// EditableText 是 React 不描述子节点的"裸壳"div——挂载时命令式写入纯文本，点击即出光标，
// 失焦读回 innerText 落库。React 永远不 reconcile 它的子节点，
// 彻底规避 contentEditable 与 ReactMarkdown 共管 DOM 导致的「优绩:」叠加与 removeChild 崩溃。
export default function EditableText({
  value,
  onCommit,
  className
}: {
  value: string;
  onCommit: (text: string) => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const initial = useRef(value);
  if (initial.current !== value) {
    // 外部值变化（换卡）时重置壳内文本
    initial.current = value;
    if (ref.current && document.activeElement !== ref.current) ref.current.innerText = value;
  }
  useEffect(() => {
    if (ref.current) ref.current.innerText = value;
    // 仅挂载/换值时写入一次；编辑过程中 React 不触碰 DOM
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div
      ref={ref}
      className={`review-editable${className ? " " + className : ""}`}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      onBlur={(e) => {
        const text = e.currentTarget.innerText.replace(/\n{3,}/g, "\n\n").trim();
        if (text && text !== initial.current.trim()) {
          initial.current = text;
          onCommit(text);
        } else if (!text) {
          // 清空不落库，恢复原值
          e.currentTarget.innerText = initial.current;
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") (e.target as HTMLElement).blur();
      }}
    />
  );
}
