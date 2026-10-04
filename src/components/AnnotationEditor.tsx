// 批注编辑浮层（批 4 Task 11，规格 §3.4 R37/R40）。
// 形态约定（与项目「编辑即写」一致）：
//   · **无「保存」「取消」按钮**——输入 400ms 防抖 + 失焦即落库；浮层内显示保存态（正在保存…/已保存）。
//   · **批注文字清空 ＝ 删除批注**（comment → null）：条目本身保留（纯高亮仍是高亮、摘录仍是摘录）。
//   · 颜色方块 → 调色浮层（用户色板 + 自定义取色）；选色即时落库。
//   · 删除按钮**按 kind 换标签**（R36）：highlight →「删除高亮」；extract →「删除摘录」；各带就地二次确认。
//   · **失焦即走**（R37 强化）：焦点离开浮层（点别处/点别的条目）→ 先把文字落库、再立刻收起；
//     Esc 同样「先落库再收起」。故浮层不会赖在屏上挡住下一次点击（实测：此前点别处不消失，
//     于是点第二条也打不开它自己的浮层）。
//   · 焦点陷阱 + Esc 关闭（useDialogA11y 既有件）；**非模态**（aria-modal=false）——它靠失焦收起，
//     不是拦着背景的模态对话框。
// 定位一律走 src/lib/popoverPlace.ts（与 MarkPopover / SelectionMenu 同一份实现）：
// 锚点＝所引那段文字的包围盒，**居中**贴其上/下方，空间不够自动翻面。
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { placePopover, type PopoverRect } from "../lib/popoverPlace";
import { useDialogA11y } from "../lib/dialogA11y";
import { ANNOT_COLORS, type AnnotColor } from "./SelectionMenu";

/** 已保存态的迟到窗口：防抖落库后短暂显示「已保存」再隐去 */
const SAVED_HINT_MS = 1400;
/** 输入防抖（R37：与项目「编辑即写」一致） */
const DEBOUNCE_MS = 400;

export interface AnnotationEditorProps {
  extractId: string;
  kind: "highlight" | "extract";
  comment: string | null;
  color: string | null;
  /** 所引原文（浮层顶部一行，截断展示） */
  quote: string;
  /** 锚点包围盒（视口坐标）——所引文字/高亮的位置 */
  anchor: PopoverRect;
  /** 容器（视口坐标；缺省＝整个视口） */
  container?: PopoverRect | null;
  /** 用户配好的色板（设置键 annotatePalette；缺省＝全 8 色） */
  palette?: readonly string[];
  /** 是否显示自定义取色（设置键 annotateCustomEnabled） */
  customEnabled?: boolean;
  /** 文字落库（comment 为 null ＝ 删除批注） */
  onSaveComment: (comment: string | null) => Promise<void>;
  /** 颜色落库 */
  onSaveColor: (color: string) => Promise<void>;
  /** 删除整条（按 kind 换标签；已含二次确认） */
  onDelete: () => Promise<void>;
  onClose: () => void;
  /**
   * v48.45（D85）：文中标记的**聚合已制卡数**（本条 + 全部子孙摘录的卡之和）——
   * 悬停浮层退役后由本浮层承接展示；缺省（摘录页宿主）不显示。
   */
  cardCount?: number;
  /** 「就此制卡」动作（走宿主的手动制卡链）；缺省不显示按钮 */
  onMakeCard?: () => void;
}

/** 色块显示色：色板 id → --annot-<id>；#hex 原样 */
export function annotColorCss(color: string | null | undefined): string {
  const c = String(color ?? "");
  if (!c) return "var(--grey-2)";
  return c.startsWith("#") ? c : `var(--annot-${c})`;
}

export default function AnnotationEditor({
  extractId,
  kind,
  comment,
  color,
  quote,
  anchor,
  container,
  palette,
  customEnabled = true,
  onSaveComment,
  onSaveColor,
  onDelete,
  onClose,
  cardCount,
  onMakeCard
}: AnnotationEditorProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [text, setText] = useState(comment ?? "");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [colorOpen, setColorOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const timerRef = useRef<number | null>(null);
  const hintRef = useRef<number | null>(null);
  /** 已落库文字（判等用：没变就不写库，避免失焦时白发一次更新） */
  const committedRef = useRef<string>(comment ?? "");
  /** 最新文字（收起时落库读它：监听器不随每次输入重挂） */
  const textRef = useRef<string>(comment ?? "");
  textRef.current = text;

  const colors = palette && palette.length ? palette : (ANNOT_COLORS as readonly string[]);

  /**
   * 点色后弹出并**聚焦输入框**（R40）——useDialogA11y 挂载时会把焦点交给面板内第一个可聚焦元素
   * （焦点陷阱要求；DOM 顺序保证它就是 textarea）。此处只补一件事：**光标落到末尾**，
   * 好让用户接着续写而不是覆盖已有批注。
   */
  useEffect(() => {
    const t = window.setTimeout(() => {
      const ta = taRef.current;
      if (!ta || document.activeElement !== ta) return;
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  // 定位：先渲染在视口外一帧等测量（与 MarkPopover/SelectionMenu 同规）
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const { left, top } = placePopover({
      anchor,
      container,
      size: { width: el.offsetWidth, height: el.offsetHeight },
      // 贴所引那段的下方居中；下方放不下自动翻到上方（空间不足再夹进容器）
      prefer: "below",
      align: "center"
    });
    setPos({ left, top });
  }, [anchor.x, anchor.y, anchor.width, anchor.height, colorOpen, confirmDelete]);

  const showSaved = () => {
    setSaveState("saved");
    if (hintRef.current) window.clearTimeout(hintRef.current);
    hintRef.current = window.setTimeout(() => setSaveState("idle"), SAVED_HINT_MS);
  };

  /** 落库（清空 ⇒ null）；返回是否真的写了 */
  const commit = async (next: string) => {
    const normalized = next.trim();
    if (normalized === committedRef.current.trim()) return false;
    committedRef.current = normalized;
    setSaveState("saving");
    try {
      await onSaveComment(normalized ? normalized : null);
      showSaved();
      return true;
    } catch {
      setSaveState("idle");
      return false;
    }
  };

  /**
   * 收起浮层：**先把文字落库、再立刻消失**。落库是已发出的 IPC 调用，不受卸载影响；
   * 不这样做的话，防抖计时器会随卸载被清掉 → 刚敲的字丢掉（实测：点别处消失后文字没保存）。
   */
  const closeAndSave = () => {
    void commit(textRef.current);
    onClose();
  };
  const panelRef = useDialogA11y<HTMLDivElement>(closeAndSave);

  // 点浮层之外 ⇒ 落库并收起（点别条目的 mousedown 先走这里，随后的 click 才能打开它自己的浮层）
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (t && panelRef.current?.contains(t)) return;
      closeAndSave();
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 400ms 防抖落库
  useEffect(() => {
    if (text.trim() === committedRef.current.trim()) return;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void commit(text), DEBOUNCE_MS);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  // 失焦即落库**并收起**（R37）：浮层内换焦点（点删除、点色块）不算「离开浮层」，
  // 故只在焦点移到**浮层之外**时才收，避免点删除时先写一次空批注。
  function handleBlur(e: React.FocusEvent<HTMLTextAreaElement>) {
    const next = e.relatedTarget as Node | null;
    if (next && panelRef.current?.contains(next)) return;
    closeAndSave();
  }

  const deleteLabel = kind === "highlight" ? "删除高亮" : "删除摘录";

  return (
    <div
      ref={panelRef}
      className="editor"
      role="dialog"
      aria-modal="false"
      aria-label={kind === "highlight" ? "编辑高亮" : "编辑摘录"}
      data-editor-kind={kind}
      data-editor-for={extractId}
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 }}
    >
      <p className="eq" title={quote}>{quote}</p>
      <textarea
        ref={taRef}
        rows={3}
        value={text}
        // 不放解释性小字（R38：清空＝删批注属直觉）；placeholder 只作输入提示
        placeholder="写批注"
        aria-label="批注文字"
        onChange={(e) => setText(e.target.value)}
        onBlur={handleBlur}
      />
      <div className="ebar">
        <button
          type="button"
          className="colorbtn"
          data-colorbtn
          title="高亮颜色"
          aria-label="高亮颜色"
          aria-expanded={colorOpen}
          style={{ background: annotColorCss(color) }}
          onClick={() => setColorOpen((v) => !v)}
        />
        <span className="save-state" data-savestate>
          {saveState === "saving" ? "正在保存…" : saveState === "saved" ? "已保存" : ""}
        </span>
        {confirmDelete ? (
          <>
            <button type="button" className="del" data-del-confirmed onClick={() => void onDelete()}>
              确认{deleteLabel}
            </button>
            <button type="button" className="del-cancel" data-del-cancel onClick={() => setConfirmDelete(false)}>
              取消
            </button>
          </>
        ) : (
          <button type="button" className="del" data-del onClick={() => setConfirmDelete(true)}>
            {deleteLabel}
          </button>
        )}
      </div>
      {/* v48.45（D85）：悬停浮层退役后由本浮层承接——「已制卡 N 张」（聚合口径）+「就此制卡」 */}
      {(cardCount !== undefined || onMakeCard) && (
        <div className="ebar editor-learn-bar" data-learn-bar>
          <span className="save-state mono" data-cardcount>
            已制卡 {cardCount ?? 0} 张
          </span>
          {onMakeCard && (
            <button type="button" className="btn btn-outline btn-sm" data-make-card onClick={onMakeCard}>
              就此制卡
            </button>
          )}
        </div>
      )}
      {colorOpen && (
        <div className="colorpop" data-colorpop>
          <div className="row" data-colorrow>
            {colors.map((c) => (
              <button
                key={c}
                type="button"
                className="swatch"
                data-color={c}
                title={`用这支色：${c}`}
                style={{ background: annotColorCss(c) }}
                onClick={() => {
                  setColorOpen(false);
                  void onSaveColor(c).then(showSaved);
                }}
              />
            ))}
          </div>
          {customEnabled && (
            <div className="customrow">
              <span>自定义</span>
              <input
                type="color"
                data-customcolor
                value={color && color.startsWith("#") ? color : "#a16207"}
                onChange={(e) => {
                  void onSaveColor(e.target.value).then(showSaved);
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
