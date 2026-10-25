// 卡面字段「读态渲染 + 点击进入编辑」外壳（C-34b，契约见 docs/EDIT-CONTRACT.md）：
// 读态用 ReadMarkdown 渲染（与全应用统一读态管线一致——取代 v11.2 的 EditableText 纯文本裸壳，
// 该裸壳读 innerText 会把 `**粗体**`/`$公式$`/`![](...)` 以源码显示、并改写空白与空行）；
// 点击 / Enter / F2 进入编辑；编辑器由调用方提供（问答字段 = MarkdownEditor，填空源文本 = ClozeDraftEditor）。
// 提交语义：内容真的变化才 onCommit；清空必填字段不保存并提示（3s 自消），**不允许静默恢复**。
import { useEffect, useRef, useState, type ReactNode } from "react";
import ReadMarkdown from "./ReadMarkdown";
import { isImeComposing } from "../../lib/ime";
import { useT } from "../../lib/i18n";

/** 进入编辑后可聚焦的编辑控件（Milkdown 创建是异步的，.ProseMirror 晚一拍出现） */
const FOCUSABLE_IN_EDITOR = ".ProseMirror, [contenteditable='true'], textarea, input";

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
  const readRef = useRef<HTMLDivElement | null>(null);
  const editHostRef = useRef<HTMLDivElement | null>(null);

  // 进入编辑即落焦点（D215，契约行为规则「进入编辑即落焦点」）：此前卡面 MarkdownEditor 各接法
  // （问答题面/答案、填空答案、看图问答）都没有焦点接线——编辑器挂载后焦点仍留在 body：打字落空、
  // 失焦提交永不触发（编辑器关不掉）、Esc 冒到 document 级监听把宿主弹层/详情面板整个关掉
  // （用户实测「点击后画面闪烁一下，然后无法编辑」）。统一在契约层接管，宿主无需各自接线；
  // 已自理焦点的编辑器（ClozeDraftEditor 挂载即聚焦 / ExtractEditor onReady）与之幂等重合。
  // Milkdown 异步创建：rAF 轮询等 .ProseMirror 出现（至多 ~1s），出现即聚焦一次。
  useEffect(() => {
    if (!editing) return;
    let raf = 0;
    let tries = 0;
    const tick = () => {
      const target = editHostRef.current?.querySelector<HTMLElement>(FOCUSABLE_IN_EDITOR);
      if (target) {
        target.focus({ preventScroll: true });
        return;
      }
      if (++tries < 60) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [editing]);

  // 退出编辑的焦点归还（D215）：编辑器仍持焦点时退出（Esc / Ctrl+Enter / 必填拦截）→ 焦点还给
  // 读态字段（键盘流不丢位置）；失焦提交（用户已点到别处）不抢——hadFocus 为假即跳过。
  const onDone = (next: string | null) => {
    const hadFocus = !!editHostRef.current?.contains(document.activeElement);
    setEditing(false);
    if (hadFocus) requestAnimationFrame(() => readRef.current?.focus({ preventScroll: true }));
    if (next === null || next === value) return;
    if (required && !next.trim()) {
      setEmptyHint(true);
      window.setTimeout(() => setEmptyHint(false), 3000);
      return;
    }
    onCommit(next);
  };

  if (editing) {
    return <div ref={editHostRef}>{renderEditor({ value, onDone })}</div>;
  }
  return (
    <div ref={readRef} className={`field-read${className ? " " + className : ""}`} role="button" tabIndex={0}
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
