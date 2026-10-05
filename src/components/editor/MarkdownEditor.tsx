// 全应用统一 Markdown 编辑器（D95 §J.2 组件抽取）：Milkdown 装配 + 提交语义（dirty 守卫/
// 幂等短路/失焦 Esc 提交/工具条）的通用受控封装。文档模型即 remark AST——「源文 markdown 进 /
// 源文 markdown 出」是它的原生路径；编辑中零写库，提交由宿主走各自既有落库链（零新写通道）。
// 工具条 16 钮全部走 commandsCtx 官方命令通道（不自改 DOM）；mousedown preventDefault 不失焦。
// 形态设置（§J.2「随组件走」）：app.extractEditorToolbar（开关）/ Float（悬浮=选区锚定弹层，§K.3）/
// Top（钉顶，§K.2）——宿主传 toolbar={false} 整行关闭；不做每面独立的形态键。
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
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
import { placePopover, type PopoverRect } from "../../lib/popoverPlace";
import { useExtractEditorToolbar, useExtractEditorToolbarFloat, useExtractEditorToolbarTop } from "../../lib/extractCardSettings";

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
 * 编辑器装配：commonmark + gfm + math(remark-math/katex) + history + listener preset（§J.2）。
 * onMarkdownUpdated＝listener 的序列化回调（提交语义的 dirty 判据来源 + 受控宿主的 onChange 镜像）。
 * 导出＝node 侧可对同一装配做创建/往返冒烟（组件与测试单一事实源）。
 */
export function createExtractEditor(
  root: HTMLElement,
  defaultValue: string,
  opts?: {
    onMarkdownUpdated?: (ctx: unknown, markdown: string, prevMarkdown: string) => void;
    /** 空文档占位提示（经 ProseMirror 根属性 + CSS ::before 呈现，零依赖） */
    placeholder?: string;
  }
): Editor {
  const viewAttrs: Record<string, string> = { class: "extract-prosemirror" };
  if (opts?.placeholder) viewAttrs["data-placeholder"] = opts.placeholder;
  return Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, defaultValue);
      ctx.update(editorViewOptionsCtx, (prev) => ({ ...prev, attributes: { ...prev.attributes, ...viewAttrs } }));
      ctx.get(listenerCtx).markdownUpdated((ctx, markdown, prevMarkdown) => {
        opts?.onMarkdownUpdated?.(ctx, markdown, prevMarkdown);
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

export interface MarkdownEditorApi {
  /** 提交：有变更且序列化 ≠ 初始值时回调 onCommit(text)，否则 onCommit(null)（幂等短路/无修改关闭） */
  commit: () => void;
  /** 块级焦点落点：把光标放到第 index 个顶层块的起始处 */
  focusBlock: (index: number) => void;
  /** 光标落文档末尾并聚焦（快速记录「继续向下写」语义） */
  focusEnd: () => void;
}

export interface MarkdownEditorProps {
  /** 初始值；**外部变更**（与最近一次上报值不同）→ 重建编辑器（宿主不得对 value 做归一变换，否则重建循环） */
  value: string;
  /** 提交回调；text = null 表示无变更或序列化与源文相同（幂等短路），宿主直接关编辑态即可 */
  onCommit: (text: string | null) => void;
  /** 文档变更即上报（受控表单镜像用：canSave 门控/实时预览）。与 onCommit 不同＝逐次输入都发 */
  onChange?: (text: string) => void;
  /** 空文档占位提示 */
  placeholder?: string;
  /** full＝卡面/页面主正文（随宿主排版）；compact＝表单字段档（矮盒、hairline 框，§J.1 #4） */
  variant?: "full" | "compact";
  /** 工具条开关（§J.2：形态设置随组件走；false＝整行不渲染，markdown 语法输入与快捷键仍在） */
  toolbar?: boolean;
  /** 最小行数（映射为 ProseMirror 最小高度；缺省 full=无、compact=2） */
  minRows?: number;
  /** 卸载时兜底提交（摘录卡「换卡不丢字」要 true；受控表单传 false 防外部置值重建时误报提交） */
  commitOnUnmount?: boolean;
  /** 键盘事件透传（宿主快捷键，如快速记录 Ctrl+Enter 发送）；Esc 由组件内部消费（提交），经 onEscape 通知宿主 */
  onKeyDown?: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
  /** Esc 已提交后通知宿主（快速记录＝flush 后隐藏窗口） */
  onEscape?: () => void;
  /** 编辑器实例就绪（可 focusBlock/命令）时回调一次 */
  onReady?: () => void;
  /** 工具条 aria 标签 */
  toolbarLabel?: string;
  /** 编辑器区域 aria 标签（表单字段可访问名） */
  ariaLabel?: string;
  /** 编辑器内容与工具条之间的附加块（摘录卡＝原始批注块；dock 钉底时保持「正文→批注→工具条」序） */
  footer?: ReactNode;
  className?: string;
}

const MarkdownEditorInner = forwardRef<MarkdownEditorApi, MarkdownEditorProps>(function MarkdownEditorInner(
  {
    value,
    onCommit,
    onChange,
    placeholder,
    variant = "full",
    toolbar = true,
    minRows,
    commitOnUnmount = false,
    onKeyDown,
    onEscape,
    toolbarLabel = "Markdown 工具栏",
    ariaLabel,
    footer,
    onReady,
    className
  },
  ref
) {
  /** listener 是否观察到过 doc 变更（提交语义的判据） */
  const dirtyRef = useRef(false);
  /** 最近一次 listener 序列化结果（卸载阶段编辑器可能已销毁，提交兜底用它） */
  const latestMdRef = useRef<string | null>(null);
  /** 提交过即不再重复提交（blur 与卸载清理可能接连触发） */
  const committedRef = useRef(false);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const editorInstanceRef = useRef<Editor | null>(null);
  /** 本会话的初始值（幂等短路的比对基准；外部置值重建时刷新） */
  const initialValueRef = useRef(value);
  /** wrapper（blur/Esc/键盘透传的挂点 + 浮层工具条测量） */
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);

  // 外部置值检测（渲染期派生重建键；对 StrictMode 双渲染幂等——第二次渲染时 value 已同步）：
  // value 与「最近一次上报值」不同 ⇒ 宿主从外部改了内容（如表单模式切换预填）⇒ 重建编辑器。
  const syncRef = useRef({ value, key: 0 });
  if (value !== syncRef.current.value) {
    syncRef.current = { value, key: syncRef.current.key + 1 };
  }
  const recreateKey = syncRef.current.key;

  const { loading, get } = useEditor(
    (root) =>
      createExtractEditor(root, value, {
        onMarkdownUpdated: (_ctx, markdown) => {
          dirtyRef.current = true;
          latestMdRef.current = markdown;
          onChangeRef.current?.(markdown);
        },
        placeholder
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recreateKey, placeholder]
  );

  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  /** onReady 只发一次的闸：useEditor 返回的 get 每次渲染都是新函数身份，effect 若随它重跑会把
      onReady 逐渲染重发——宿主的 focusBlock 会把光标塌到块首（实测：悬浮弹层挂载引发的
      一次普通重渲染就丢掉了用户刚拖出的选区） */
  const readyRef = useRef(false);

  useEffect(() => {
    if (!loading) {
      editorInstanceRef.current = get() ?? null;
      if (editorInstanceRef.current && !readyRef.current) {
        readyRef.current = true;
        onReadyRef.current?.();
      }
    }
  }, [loading, get]);

  // 重建（外部置值）＝新编辑会话：dirty/提交闸复位，比对基准换成新值，onReady 重新通知宿主
  useEffect(() => {
    initialValueRef.current = value;
    dirtyRef.current = false;
    latestMdRef.current = null;
    committedRef.current = false;
    readyRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recreateKey]);

  const commit = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    if (!dirtyRef.current) {
      // listener 未观察到 doc 变更 → 不提交直接退回（「无修改关闭逐字节不变」的构造性保证）
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
    onCommitRef.current(md === null || md === initialValueRef.current ? null : md);
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

  const focusEnd = () => {
    const editor = editorInstanceRef.current;
    if (!editor) return;
    try {
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { doc } = view.state;
        const $pos = doc.resolve(Math.max(0, doc.content.size - 1));
        view.dispatch(view.state.tr.setSelection(TextSelection.near($pos, -1)).scrollIntoView());
        view.focus();
      });
    } catch {
      /* 编辑器未就绪/已销毁：静默 */
    }
  };

  useImperativeHandle(ref, () => ({ commit, focusBlock, focusEnd }), []);

  // 失焦提交（§D.5 语义：点编辑区外 → blur → 提交；工具条 mousedown preventDefault 不会触发）。
  // 必须同步：blur 由点击宿主动作引起时，click 处理器在 blur 之后执行——若推迟到宏任务，
  // click 的守卫会抢先落下，随后的提交被静默丢弃＝丢用户正文（D95 审查 P0 同款教训）。
  // 同步序保证「先提交、后动作」；committedRef 幂等防重（与卸载提交可能接连发生）。
  const onRootBlur = () => {
    commit();
  };

  // Esc＝提交并退回（与摘录卡 EditableText 时代语义一致）；其余键透传宿主（Ctrl+Enter 等）
  const onRootKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      commit();
      onEscape?.();
      return;
    }
    onKeyDown?.(e);
  };

  // 卸载兜底提交（commitOnUnmount；摘录卡「换卡/宿主退出编辑不丢字」用，受控表单不用）
  useEffect(
    () => () => {
      if (commitOnUnmount) commit();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // ---------- 工具条（16 钮；形态＝dock-bottom / dock-top / float-selection） ----------
  const toolbarOn = useExtractEditorToolbar();
  const toolbarFloat = useExtractEditorToolbarFloat();
  const toolbarTop = useExtractEditorToolbarTop();
  const showToolbar = toolbar && toolbarOn;
  const toolbarMode: "dock-bottom" | "dock-top" | "float-selection" = toolbarFloat
    ? "float-selection"
    : toolbarTop
      ? "dock-top"
      : "dock-bottom";

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

  // ---------- 悬浮态＝选区锚定弹层（§K.3，与 SelectionMenu/AnnotationEditor 同一族定位逻辑） ----------
  // 仅编辑态出现；锚点＝编辑器内当前选区的包围盒（上方居中，空间不足翻转到下方居中）。
  // 出现时机与选区菜单家族一致＝**手势完成（mouseup）之后**——拖选中途挂载弹层会触发
  // ProseMirror 把 DOM 选区重置回过期 state（实测：selectionchange 内同步挂载 portal +
  // 强制布局，原生拖选扩展被打断、PM 以自身（塌缩）state 覆写 DOM 选区＝选区丢失）。
  // 收起时机：选区塌缩（点击正文落 caret）/ 滚动 / 换卡（卸载）；命令后选区变化即重算锚点。
  const [floatAnchor, setFloatAnchor] = useState<PopoverRect | null>(null);
  const [floatPos, setFloatPos] = useState<{ left: number; top: number; placement: "above" | "below" } | null>(null);
  const dragActiveRef = useRef(false);
  /** 锚点读取的去重 rAF 句柄：**挂载/卸载弹层永远出帧执行**——在 selectionchange 事件派发内
      同步挂载 portal（实测）会打断 ProseMirror 的选区收尾（PM 把 DOM 选区重置回过期 state） */
  const anchorRafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!showToolbar || toolbarMode !== "float-selection") {
      setFloatAnchor(null);
      return;
    }
    const readSelection = () => {
      const root = wrapRef.current?.querySelector(".ProseMirror") ?? null;
      const sel = typeof window !== "undefined" ? window.getSelection() : null;
      if (!root || !sel || !sel.rangeCount) {
        setFloatAnchor(null);
        return;
      }
      const range = sel.getRangeAt(0);
      if (!root.contains(range.commonAncestorContainer) || sel.isCollapsed) {
        setFloatAnchor(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      if (!rect || (!rect.width && !rect.height)) {
        setFloatAnchor(null);
        return;
      }
      setFloatAnchor({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
    };
    const scheduleRead = () => {
      if (anchorRafRef.current != null) return;
      anchorRafRef.current = window.requestAnimationFrame(() => {
        anchorRafRef.current = null;
        readSelection();
      });
    };
    const onSelectionChange = () => {
      // 拖选手势进行中不挂载/不重定位（见上注）；塌选仍要即时收（点正文落 caret）
      if (dragActiveRef.current) return;
      scheduleRead();
    };
    const onDown = (e: MouseEvent) => {
      const root = wrapRef.current?.querySelector(".ProseMirror") ?? null;
      dragActiveRef.current = !!root && !!e.target && root.contains(e.target as Node);
      if (anchorRafRef.current != null) {
        window.cancelAnimationFrame(anchorRafRef.current);
        anchorRafRef.current = null;
      }
      if (dragActiveRef.current) setFloatAnchor(null);
    };
    const onUp = () => {
      const wasDragging = dragActiveRef.current;
      dragActiveRef.current = false;
      // 等 PM 完成拖选收尾（state 定格）再读；rAF 同时保证挂载出帧（见 anchorRafRef 注）
      if (wasDragging) scheduleRead();
    };
    const onScrollOrResize = () => setFloatAnchor(null); // 锚点失效（滚动/改窗）即收起
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
      if (anchorRafRef.current != null) {
        window.cancelAnimationFrame(anchorRafRef.current);
        anchorRafRef.current = null;
      }
    };
  }, [showToolbar, toolbarMode]);

  // 定位：先渲染在视口外一帧等测量（浮层家族同规），再按实测尺寸算位置；翻面侧随 placement 给 transform-origin
  useLayoutEffect(() => {
    if (toolbarMode !== "float-selection" || !floatAnchor) {
      setFloatPos(null);
      return;
    }
    const el = toolbarRef.current;
    if (!el) return;
    const res = placePopover({
      anchor: floatAnchor,
      size: { width: el.offsetWidth, height: el.offsetHeight },
      prefer: "above",
      align: "center"
    });
    setFloatPos(res);
  }, [floatAnchor, toolbarMode]);

  // 悬浮态只在**有锚点**时挂载（无选区＝弹层不存在；塌选/滚动即整层卸载）；每次重挂重播 pop-in，
  // 与弹窗家族「出现即入位」一致。dock 两态恒渲染（sticky 随文档流）。
  const toolbarNode =
    showToolbar && (toolbarMode !== "float-selection" || floatAnchor) ? (
    <div
      ref={toolbarRef}
      className={`extract-face-toolbar md-toolbar-${variant}${toolbarMode === "float-selection" ? " is-float-pop" : toolbarMode === "dock-top" ? " is-dock-top" : " is-dock-bottom"}`}
      data-testid="extract-editor-toolbar"
      data-toolbar-mode={toolbarMode}
      data-place={floatPos?.placement}
      role="toolbar"
      aria-label={toolbarLabel}
      style={
        toolbarMode === "float-selection"
          ? floatPos
            ? { left: floatPos.left, top: floatPos.top }
            : { left: -9999, top: 0 }
          : undefined
      }
      /* mousedown preventDefault：点工具条不转移焦点（ProseMirror 不失焦、选区保住＝弹层不收） */
      onMouseDown={(e) => e.preventDefault()}
    >
      {BUTTONS.map((b) => (
        <button key={b.tb} type="button" className="extract-face-toolbar-btn" data-tb={b.tb} title={b.title} onClick={b.run}>
          {b.label}
        </button>
      ))}
    </div>
  ) : null;

  return (
    <div
      ref={wrapRef}
      className={`markdown-editor markdown-editor-${variant}${className ? ` ${className}` : ""}`}
      aria-label={ariaLabel}
      onBlur={onRootBlur}
      onKeyDown={onRootKeyDown}
      style={minRows ? ({ ["--md-editor-min-rows" as string]: String(minRows) } as CSSProperties) : undefined}
    >
      <Milkdown />
      {footer}
      {/* 悬浮弹层 portal 到 body：卡片宿主普遍带入场动画（fill both 的 transform 动画使其成为
          fixed 后代的包含块，如 .extract-face 的 stage-card-in）——portal 脱离动画子树，
          placePopover 的视口坐标才成立（弹窗家族本就渲染在页级，同一理由）。 */}
      {toolbarNode && toolbarMode === "float-selection" ? createPortal(toolbarNode, document.body) : toolbarNode}
    </div>
  );
});

/**
 * 通用受控 Markdown 编辑器（MilkdownProvider 挂 here；宿主无感知）。
 * 工具条 DOM 序恒在编辑器之后（dock-top 由 flex order:-1 顶到视觉首位，sticky 随排序后位置生效）。
 */
export const MarkdownEditor = forwardRef<MarkdownEditorApi, MarkdownEditorProps>(function MarkdownEditor(
  props,
  ref
) {
  return (
    <MilkdownProvider>
      <MarkdownEditorInner {...props} ref={ref} />
    </MilkdownProvider>
  );
});

export default MarkdownEditor;
