// 卡面字段「读态渲染 + 点击进入编辑」外壳（C-34b，契约见 docs/EDIT-CONTRACT.md）：
// 读态用 ReadMarkdown 渲染（与全应用统一读态管线一致——取代 v11.2 的 EditableText 纯文本裸壳，
// 该裸壳读 innerText 会把 `**粗体**`/`$公式$`/`![](...)` 以源码显示、并改写空白与空行）；
// 点击 / Enter / F2 进入编辑；编辑器由调用方提供（问答字段 = MarkdownEditor，填空源文本 = ClozeDraftEditor）。
// 提交语义：内容真的变化才 onCommit；清空必填字段不保存并提示（3s 自消），**不允许静默恢复**。
import { useState, type ReactNode } from "react";
import ReadMarkdown from "./ReadMarkdown";
import { isImeComposing } from "../../lib/ime";
import { useT } from "../../lib/i18n";

export default function EditableField({ value, display, required, onCommit, renderEditor, className }: {
  value: string;                       // 编辑的源文本
  display?: ReactNode;                 // 读态显示（缺省 = 渲染 value）
  required?: boolean;                  // 必填：清空时不保存并提示
  onCommit: (next: string) => void;    // 只在内容真的变化时调用
  renderEditor: (p: { value: string; onDone: (next: string | null) => void }) => ReactNode;
  className?: string;
}) {
  const T = useT();
  const [editing, setEditing] = useState(false);
  const [emptyHint, setEmptyHint] = useState(false);
  const onDone = (next: string | null) => {
    setEditing(false);
    if (next === null || next === value) return;
    if (required && !next.trim()) {
      setEmptyHint(true);
      window.setTimeout(() => setEmptyHint(false), 3000);
      return;
    }
    onCommit(next);
  };
  if (editing) return <>{renderEditor({ value, onDone })}</>;
  return (
    <div className={`field-read${className ? " " + className : ""}`} role="button" tabIndex={0}
      onClick={(e) => { if ((e.target as HTMLElement).closest("a,button,audio")) return; setEditing(true); }}
      onKeyDown={(e) => {
        if (isImeComposing(e)) return;
        if (e.key === "Enter" || e.key === "F2") { e.preventDefault(); setEditing(true); }
      }}>
      {display ?? <ReadMarkdown text={value} />}
      {emptyHint && <p className="field-empty-hint" role="status">{T("内容为空，未保存")}</p>}
    </div>
  );
}
