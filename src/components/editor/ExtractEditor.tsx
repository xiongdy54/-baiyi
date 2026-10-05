// 摘录卡 WYSIWYG 编辑器（D95 §B/§E/§D.5）：@milkdown/kit 封装。
// 文档模型即 remark AST——「源文 markdown 进 / 源文 markdown 出」是它的原生路径；
// 提交语义（§B.3）：编辑中零写库；失焦/Esc 提交；listener 未观察到 doc 变更 → 不提交直接退读态；
// 序列化结果与 defaultValue 相同 → 幂等短路不回调（保证「无修改退出逐字节不变」）。
// 工具栏 16 钮全部走 commandsCtx 官方命令通道（不自改 DOM）；mousedown preventDefault 不失焦。
import { forwardRef, useEffect, useImperativeHandle, useRef, type ReactNode } from "react";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import {
  Editor,
  EditorStatus,
  defaultValueCtx,
  editorViewCtx,
  editorViewOptionsCtx,
  rootCtx,
  commandsCtx
} from "@milkdown/kit/core";
import {
  commonmark,
  createCodeBlockCommand,
  insertHrCommand,
  headingSchema,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
  toggleStrongCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand
} from "@milkdown/kit/preset/commonmark";
import { gfm, toggleStrikethroughCommand } from "@milkdown/kit/preset/gfm";
import { history, redoCommand, undoCommand } from "@milkdown/kit/plugin/history";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { $command, $nodeSchema, $remark, getMarkdown } from "@milkdown/kit/utils";
import { NodeSelection, TextSelection } from "@milkdown/kit/prose/state";
import katex from "katex";
import remarkMath from "remark-math";

// ---------- math 扩展（官方 kit 无 math 预设；按 crepe latex feature 同款 $remark/$nodeSchema 装配） ----------

/** remark-math 同时携带 mdast↔micromark 的 parse 与 stringify 扩展：milkdown 的序列化走同一个
 *  remark 处理器（core 把 remarkPluginsCtx 逐个 .use() 进去），math/inlineMath 节点因此可往返 */
const remarkMathPlugin = $remark("extractRemarkMath", () => remarkMath);

const inlineMathSchema = $nodeSchema("extract_math_inline", () => ({
  group: "inline",
  inline: true,
  draggable: true,
  atom: true,
  attrs: { value: { default: "" } },
  parseDOM: [
    {
      tag: `span[data-type="math-inline"]`,
      getAttrs: (dom) => ({ value: (dom instanceof HTMLElement ? dom.dataset.value : null) ?? "" })
    }
  ],
  toDOM: (node) => {
    const value = String(node.attrs.value ?? "");
    const el = document.createElement("span");
    el.dataset.type = "math-inline";
    el.dataset.value = value;
    el.className = "extract-math-inline";
    katex.render(value, el, { throwOnError: false });
    return el;
  },
  parseMarkdown: {
    match: (node) => node.type === "inlineMath",
    runner: (state, node, type) => {
      state.addNode(type, { value: String(node.value ?? "") });
    }
  },
  toMarkdown: {
    match: (node) => node.type.name === "extract_math_inline",
    runner: (state, node) => {
      state.addNode("inlineMath", undefined, String(node.attrs.value ?? ""));
    }
  }
}));

const mathBlockSchema = $nodeSchema("extract_math_block", () => ({
  group: "block",
  content: "text*",
  code: true,
  defining: true,
  attrs: {},
  parseDOM: [{ tag: `div[data-type="math-block"]` }],
  toDOM: () => ["div", { "data-type": "math-block", class: "extract-math-block" }, ["div", { class: "extract-math-block-src" }, 0]],
  parseMarkdown: {
    match: (node) => node.type === "math",
    runner: (state, node, type) => {
      state.openNode(type);
      if (node.value) state.addText(String(node.value));
      state.closeNode();
    }
  },
  toMarkdown: {
    match: (node) => node.type.name === "extract_math_block",
    runner: (state, node) => {
      state.addNode("math", undefined, node.textContent || "");
    }
  }
}));

/** 行内公式 ⇄ 选中文本（crepe toggleLatexCommand 同款往返；P0 不做浮层内编辑，反向即还原为文本） */
const toggleInlineMathCommand = $command("ToggleExtractInlineMath", (ctx) => () => (state, dispatch) => {
  const t = inlineMathSchema.type(ctx);
  const { selection } = state;
  if (selection instanceof NodeSelection && selection.node.type === t) {
    const pos = selection.from;
    const value = String(selection.node.attrs.value ?? "");
    if (dispatch) {
      const tr = state.tr.delete(pos, pos + 1).insertText(value, pos);
      dispatch(tr.setSelection(TextSelection.create(tr.doc, pos + value.length)));
    }
    return true;
  }
  const { from, to } = selection;
  const text = state.doc.textBetween(from, to, "\n");
  if (dispatch) {
    dispatch(state.tr.replaceSelectionWith(t.create({ value: text })));
  }
  return true;
});

/** 公式块：光标处插入空块（块内文本即 TeX，以源码形式呈现） */
const insertMathBlockCommand = $command("InsertExtractMathBlock", (ctx) => () => (state, dispatch) => {
  const t = mathBlockSchema.type(ctx);
  if (dispatch) {
    dispatch(state.tr.replaceSelectionWith(t.create()));
  }
  return true;
});

/** 任务列表＝无序列表 + 选中 list_item 打上 checked 标记（gfm 预设无任务命令，这是官方命令通道上的最小组合） */
const setTaskCheckedCommand = $command("SetExtractTaskChecked", () => () => (state, dispatch) => {
  const { from, to } = state.selection;
  const tr = state.tr;
  let done = false;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === "list_item" && node.attrs.checked == null) {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: false });
      done = true;
    }
    return true;
  });
  if (done && dispatch) dispatch(tr);
  return done;
});

/**
 * 编辑器装配：commonmark + gfm + math(remark-math/katex) + history + listener preset（§G.1 #3）。
 * onMarkdownUpdated＝listener 的序列化回调（提交语义 §B.3 的 dirty 判据来源）。
 * 导出＝node 侧可对同一装配做创建/往返冒烟（组件与测试单一事实源）。
 */
export function createExtractEditor(
  root: HTMLElement,
  defaultValue: string,
  onMarkdownUpdated?: (ctx: unknown, markdown: string, prevMarkdown: string) => void
): Editor {
  return Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, defaultValue);
      ctx.update(editorViewOptionsCtx, (prev) => ({ ...prev, attributes: { class: "extract-prosemirror" } }));
      ctx.get(listenerCtx).markdownUpdated((ctx, markdown, prevMarkdown) => {
        onMarkdownUpdated?.(ctx, markdown, prevMarkdown);
      });
    })
    .use(commonmark)
    .use(gfm)
    .use(remarkMathPlugin)
    .use(inlineMathSchema)
    .use(mathBlockSchema)
    .use(toggleInlineMathCommand)
    .use(insertMathBlockCommand)
    .use(setTaskCheckedCommand)
    .use(history)
    .use(listener);
}

export interface ExtractEditorApi {
  /** 提交：有变更且序列化 ≠ defaultValue 时回调 onCommit(text)，否则 onCommit(null)（幂等短路/无修改退读态） */
  commit: () => void;
  /** §D.2 P0 块级焦点落点：把光标放到第 index 个顶层块的起始处 */
  focusBlock: (index: number) => void;
}

interface ExtractEditorProps {
  defaultValue: string;
  /** 提交回调；text = null 表示无变更或序列化与源文相同（幂等短路），宿主直接退读态即可 */
  onCommit: (text: string | null) => void;
  /** §D.2 P0：进入编辑时的焦点块索引（null＝光标落文档开头） */
  pendingFocusIndex?: number | null;
  /** §E：工具栏开关（app.extractEditorToolbar）；关闭后整行不渲染 */
  toolbar?: boolean;
  /** v1.4：工具栏形态（app.extractEditorToolbarFloat）——false＝钉在文本框底端（dock，默认），true＝悬浮面板 */
  float?: boolean;
  /** v1.4：编辑器内容与工具栏之间的附加块（摘录卡＝原始批注块）——dock 钉底时保持
      「正文 → 批注 → 工具条@盒底缘」的顺序（批注块在宿主侧渲染会落到工具条之后） */
  footer?: ReactNode;
}

export const ExtractEditor = forwardRef<ExtractEditorApi, ExtractEditorProps>(function ExtractEditor(
  props,
  ref
) {
  return (
    <MilkdownProvider>
      <ExtractEditorInner {...props} ref={ref} />
    </MilkdownProvider>
  );
});

const ExtractEditorInner = forwardRef<ExtractEditorApi, ExtractEditorProps>(function ExtractEditorInner(
  { defaultValue, onCommit, pendingFocusIndex, toolbar = true, float = false, footer },
  ref
) {
  /** listener 是否观察到过 doc 变更（§B.3 提交语义的判据） */
  const dirtyRef = useRef(false);
  /** 最近一次 listener 序列化结果（卸载阶段编辑器可能已销毁，提交兜底用它） */
  const latestMdRef = useRef<string | null>(null);
  /** 提交过即不再重复提交（blur 与卸载清理可能接连触发） */
  const committedRef = useRef(false);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const editorInstanceRef = useRef<Editor | null>(null);
  const focusIndexRef = useRef<number | null>(pendingFocusIndex ?? null);

  const { loading, get } = useEditor(
    (root) =>
      createExtractEditor(
        root,
        defaultValue,
        (_ctx, markdown) => {
          dirtyRef.current = true;
          latestMdRef.current = markdown;
        }
      ),
    [defaultValue]
  );

  useEffect(() => {
    if (!loading) editorInstanceRef.current = get() ?? null;
  }, [loading, get]);

  const commit = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    if (!dirtyRef.current) {
      // listener 未观察到 doc 变更 → 不提交直接退读态（「无修改退出逐字节不变」的构造性保证）
      onCommitRef.current(null);
      return;
    }
    let md = latestMdRef.current;
    const editor = editorInstanceRef.current;
    if (editor && editor.status === EditorStatus.Created) {
      try {
        md = editor.action(getMarkdown());
      } catch {
        /* 编辑器已销毁：退回 listener 的最近序列化结果 */
      }
    }
    onCommitRef.current(md === null || md === defaultValue ? null : md);
  };

  const focusBlock = (index: number) => {
    const editor = editorInstanceRef.current;
    if (!editor) return;
    try {
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { doc } = view.state;
        if (doc.childCount === 0) return;
        const i = Math.max(0, Math.min(index, doc.childCount - 1));
        let pos = 0;
        for (let j = 0; j < i; j++) pos += doc.child(j).nodeSize;
        const $pos = doc.resolve(Math.min(pos + 1, doc.content.size));
        view.dispatch(view.state.tr.setSelection(TextSelection.near($pos, 1)).scrollIntoView());
        view.focus();
      });
    } catch {
      /* 编辑器未就绪/已销毁：静默 */
    }
  };

  useImperativeHandle(ref, () => ({ commit, focusBlock }), []);

  // 失焦提交（§D.5：EDIT 态点卡外 → blur → 提交 → READ；工具栏 mousedown preventDefault 不会触发）。
  // 必须同步（旧 EditableText 语义）：blur 由点击底栏动作引起时，click 处理器在 blur 之后执行——
  // 若推迟到宏任务，click 的 busy 守卫会抢先落下，随后的提交被静默丢弃＝丢用户正文（D95 审查 P0）。
  // 同步序保证「先提交、后动作」；committedRef 幂等防重（与卸载提交可能接连发生）。
  const onRootBlur = () => {
    commit();
  };

  // 编辑器就绪即接管焦点：落点＝宿主给的块索引（§D.2 P0 块级；不可用时落文档开头）
  useEffect(() => {
    if (loading) return;
    focusBlock(focusIndexRef.current ?? 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // 卸载＝换卡/宿主退出编辑：有未提交变更先提交（不丢字）
  useEffect(
    () => () => {
      commit();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const run = (fn: (editor: Editor) => void) => {
    const editor = editorInstanceRef.current;
    if (!editor) return;
    try {
      fn(editor);
    } catch {
      /* 编辑器未就绪/已销毁：静默 */
    }
  };

  const call = (cmdKey: unknown, payload?: unknown) => {
    run((editor) => {
      editor.action((ctx) => {
        ctx.get(commandsCtx).call(cmdKey as never, payload as never);
      });
    });
  };

  /** 标题 H1→H2→H3→正文 循环（§E） */
  const headingCycle = () => {
    run((editor) => {
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const headingType = headingSchema.type(ctx);
        let level = 0;
        const { $from } = view.state.selection;
        for (let d = $from.depth; d > 0; d--) {
          const n = $from.node(d);
          if (n.type === headingType) {
            level = Number(n.attrs.level) || 0;
            break;
          }
        }
        const next = level === 0 ? 1 : level >= 3 ? 0 : level + 1;
        ctx.get(commandsCtx).call(wrapInHeadingCommand.key, next);
      });
    });
  };

  /** 任务列表：先包无序列表，再给选中的 list_item 打 checked（同一命令通道顺序两发） */
  const taskList = () => {
    run((editor) => {
      editor.action((ctx) => {
        const mgr = ctx.get(commandsCtx);
        mgr.call(wrapInBulletListCommand.key);
        mgr.call(setTaskCheckedCommand.key);
      });
    });
  };

  /** §E 16 钮：行内六 + 块级八 + 历史二 */
  const BUTTONS: Array<{ tb: string; label: string; title: string; run: () => void }> = [
    { tb: "bold", label: "B", title: "加粗", run: () => call(toggleStrongCommand.key) },
    { tb: "italic", label: "I", title: "斜体", run: () => call(toggleEmphasisCommand.key) },
    { tb: "strike", label: "S", title: "删除线", run: () => call(toggleStrikethroughCommand.key) },
    { tb: "code", label: "‹›", title: "行内代码", run: () => call(toggleInlineCodeCommand.key) },
    { tb: "link", label: "链接", title: "链接（选中文字后点此；再点一次取消）", run: () => call(toggleLinkCommand.key, {}) },
    { tb: "inlineMath", label: "$x$", title: "行内公式", run: () => call(toggleInlineMathCommand.key) },
    { tb: "h", label: "H", title: "标题（H1→H2→H3→正文 循环）", run: headingCycle },
    { tb: "quote", label: "❝", title: "引用", run: () => call(wrapInBlockquoteCommand.key) },
    { tb: "ul", label: "• 列表", title: "无序列表", run: () => call(wrapInBulletListCommand.key) },
    { tb: "ol", label: "1. 列表", title: "有序列表", run: () => call(wrapInOrderedListCommand.key) },
    { tb: "task", label: "☐ 任务", title: "任务列表", run: taskList },
    { tb: "codeBlock", label: "代码块", title: "代码块", run: () => call(createCodeBlockCommand.key) },
    { tb: "hr", label: "—", title: "分隔线", run: () => call(insertHrCommand.key) },
    { tb: "mathBlock", label: "$$", title: "公式块", run: () => call(insertMathBlockCommand.key) },
    { tb: "undo", label: "↩", title: "撤销（编辑器内历史）", run: () => call(undoCommand.key) },
    { tb: "redo", label: "↪", title: "重做", run: () => call(redoCommand.key) }
  ];

  return (
    <div className="extract-editor" onBlur={onRootBlur}>
      <Milkdown />
      {footer}
      {toolbar && (
        <div
          className={`extract-face-toolbar${float ? " is-float" : ""}`}
          data-testid="extract-editor-toolbar"
          data-toolbar-mode={float ? "float" : "dock"}
          role="toolbar"
          aria-label="摘录编辑工具栏"
          /* mousedown preventDefault：点工具栏不转移焦点（ProseMirror 不失焦，§D.5） */
          onMouseDown={(e) => e.preventDefault()}
        >
          {BUTTONS.map((b) => (
            <button key={b.tb} type="button" className="extract-face-toolbar-btn" data-tb={b.tb} title={b.title} onClick={b.run}>
              {b.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
