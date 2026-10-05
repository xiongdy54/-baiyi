// 摘录卡编辑器壳（D95 §J.2 组件抽取后）：Milkdown 装配/提交语义/工具条已全部下沉到通用组件
// `MarkdownEditor`，本组件只保留摘录卡特有的两件事——
//   ① §D.2 P0 块级焦点落点（进编辑时光标落到点击所在块）；
//   ② commitOnUnmount（换卡/宿主退出编辑时的卸载兜底提交，不丢字）。
// 提交语义（§B.3）：编辑中零写库；失焦/Esc 提交（均在通用组件内）；listener 未观察到 doc 变更 →
// 不提交直接退读态；序列化结果与初始值相同 → 幂等短路不回调（保证「无修改退出逐字节不变」）。
import { forwardRef, useImperativeHandle, useRef, type ReactNode } from "react";
import { MarkdownEditor, type MarkdownEditorApi } from "./MarkdownEditor";

export type ExtractEditorApi = MarkdownEditorApi;

interface ExtractEditorProps {
  defaultValue: string;
  /** 提交回调；text = null 表示无变更或序列化与源文相同（幂等短路），宿主直接退读态即可 */
  onCommit: (text: string | null) => void;
  /** §D.2 P0：进入编辑时的焦点块索引（null＝光标落文档开头） */
  pendingFocusIndex?: number | null;
  /** v1.3：编辑器内容与工具条之间的附加块（摘录卡＝原始批注块） */
  footer?: ReactNode;
  /** D97：编辑器上方的附加块（摘录卡＝「摘录原文」节标签——钉顶时工具条排到标签之前） */
  header?: ReactNode;
}

export const ExtractEditor = forwardRef<ExtractEditorApi, ExtractEditorProps>(function ExtractEditor(
  { defaultValue, onCommit, pendingFocusIndex, footer, header },
  ref
) {
  const editorRef = useRef<MarkdownEditorApi | null>(null);
  const focusIndexRef = useRef<number | null>(pendingFocusIndex ?? null);

  useImperativeHandle(ref, () => ({
    commit: () => editorRef.current?.commit(),
    focusBlock: (index: number) => editorRef.current?.focusBlock(index),
    focusEnd: () => editorRef.current?.focusEnd()
  }));

  return (
    <MarkdownEditor
      ref={editorRef}
      value={defaultValue}
      onCommit={onCommit}
      variant="full"
      commitOnUnmount
      footer={footer}
      header={header}
      className="extract-editor"
      onReady={() => {
        // 编辑器就绪即接管焦点：落点＝宿主给的块索引（§D.2 P0 块级；不可用时落文档开头）
        editorRef.current?.focusBlock(focusIndexRef.current ?? 0);
      }}
    />
  );
});
