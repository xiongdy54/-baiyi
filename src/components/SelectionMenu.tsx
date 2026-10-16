// 选区浮条（D122，取代 D83/D84 的「批注框+色块」菜单；设计稿 docs/design/SELECTION-POPOVER-D122.md）：
// 选中文字后出现在选区**上方**（放不下翻到下方）的一行横条——
//   色点（方块，点色＝按当前「摘录/形式」完成标注）｜批注/制卡/AI 制卡/AI 解释/查词｜标注选项 ▸
// · 「摘录」不再是动作按钮而是**标注选项**：开＝点色同时进摘录队列（原 annotateMode=extract），
//   形式（底色/下划线）同理（原 annotateForm）。两者收在最右「标注选项」钮里，点开**向右**展开，
//   折叠态钮面显示当前值，不占行。
// · 批注默认折叠（渐进披露）：点「批注」向下展开文本框；写好后点色＝批注随标注保存，
//   或 Ctrl+Enter＝用上一次点过的颜色保存；Esc 收起。
// · 动作呈现按 app.selectionBarStyle：icon（默认，编辑条同款 16px 图标）| text（文字标签）。
// 定位一律走 src/lib/popoverPlace.ts（R22：锚点＝选区包围盒）；高度/宽度变化（展开批注/选项）
// 由 ResizeObserver 重新定位，保证贴近选区的那条边不动。
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { placePopover, type PopoverRect } from "../lib/popoverPlace";
import type { SelectionBarStyle } from "../lib/selectionBarSettings";
import { useT } from "../lib/i18n";
import {
  IconSelAiCards,
  IconSelCard,
  IconSelChevron,
  IconSelExplain,
  IconSelLookup,
  IconSelMark,
  IconSelNote
} from "./selectionIcons";

/** 批注色板 id（规格 §2）：渲染取 --annot-<name>；颜色不承载调度语义 */
export const ANNOT_COLORS = ["red", "orange", "yellow", "green", "teal", "blue", "purple", "magenta"] as const;
export type AnnotColor = (typeof ANNOT_COLORS)[number];

/**
 * 标注模式（R38）：`highlight`＝纯批注（不进队列）；`extract`＝摘录+高亮（进队列）。
 * 标记形式（v48.41/D81）：`highlight`＝底色高亮；`underline`＝批注色下划线（透明底）。
 */
export type AnnotMenuMode = "highlight" | "extract";
export type AnnotMarkForm = "highlight" | "underline";
export type AnnotMode = AnnotMarkForm;

export interface SelectionMenuAction {
  key: string;
  label: string;
  onClick: () => void;
}

/** 浮条里对选区做事的四个动作（与快捷键 Ctrl+Z/X/A/D 同源 selAct.*） */
export interface SelectionBarActions {
  manual: () => void;
  aiCards: () => void;
  explain: () => void;
  lookup: () => void;
}

const COLOR_NAMES: Record<string, string> = {
  red: "红", orange: "橙", yellow: "黄", green: "绿", teal: "青", blue: "蓝", purple: "紫", magenta: "品红"
};
const FORM_LABEL: Record<AnnotMarkForm, string> = { highlight: "底色", underline: "下划线" };

export default function SelectionMenu({
  anchor,
  container,
  colors,
  onPick,
  byLocked = false,
  mode = "highlight",
  onModeChange,
  form = "highlight",
  onFormChange,
  barStyle = "icon",
  actions
}: {
  /** 选区包围盒（视口坐标）——R22 判据 4 */
  anchor: PopoverRect;
  /** 阅读容器（视口坐标；浮条夹在它内部，含 8px 边距） */
  container?: PopoverRect | null;
  /** 用户配好的色板（设置键 annotatePalette）；空则不渲染色点 */
  colors: readonly string[];
  /** 点色＝按当前模式与形式完成标注；第二参＝批注文字（空串＝无批注） */
  onPick: (color: AnnotColor, comment: string) => void;
  /**
   * 多段选择修饰键按住期间置位：浮条**让路**——整块 pointer-events:none，
   * 好让「按住 Ctrl 拖选下一段」的起笔落在正文而不是浮条上。
   */
  byLocked?: boolean;
  /** 当前标注模式 / 形式与改写回调（持久键 app.annotateMode / app.annotateForm） */
  mode?: AnnotMenuMode;
  onModeChange?: (m: AnnotMenuMode) => void;
  form?: AnnotMarkForm;
  onFormChange?: (f: AnnotMarkForm) => void;
  /** 动作呈现：icon（默认）| text */
  barStyle?: SelectionBarStyle;
  /** 四个选区动作；缺省＝不渲染动作区 */
  actions?: SelectionBarActions;
}) {
  const T = useT();
  const ref = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  // 批注草稿 + 展开态：随选区（锚点）更换即重置——浮条是「这一次标注」的一次性面板
  const [comment, setComment] = useState("");
  const [commentOpen, setCommentOpen] = useState(false);
  const [optsOpen, setOptsOpen] = useState(false);
  // 「上一次点过的颜色」：Ctrl+Enter 默认用它；首次＝色板第一支
  const lastColor = useRef<string | null>(null);
  useEffect(() => {
    setComment("");
    setCommentOpen(false);
  }, [anchor.x, anchor.y, anchor.width, anchor.height]);

  const place = () => {
    const el = ref.current;
    if (!el) return;
    // 先渲染在视口外一帧等测量（left:-9999），再按实测尺寸算位置——避免首帧闪到错误位置。
    // 默认在选区上方（prefer above）：不盖住下一行文字；放不下 placePopover 自动翻到下方。
    const { left, top } = placePopover({
      anchor,
      container,
      size: { width: el.offsetWidth, height: el.offsetHeight },
      prefer: "above"
    });
    setPos((p) => (p && p.left === left && p.top === top ? p : { left, top }));
  };

  useLayoutEffect(place, [anchor.x, anchor.y, anchor.width, anchor.height, container?.x, container?.y, container?.width, container?.height, colors.length, barStyle]);

  // 批注/选项展开动画期间尺寸逐帧变化：随之重新定位（上方时固定下沿向上长）
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => place());
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor.x, anchor.y, anchor.width, anchor.height, container?.x, container?.y, container?.width, container?.height]);

  const pick = (c: string) => {
    lastColor.current = c;
    onPick(c as AnnotColor, comment.trim());
  };

  const toggleComment = () => {
    setCommentOpen((o) => {
      if (!o) setTimeout(() => textRef.current?.focus(), 120);
      return !o;
    });
  };

  // 点按钮不夺走正文选区（textarea 例外：它要拿焦点）
  const keepSel = (e: ReactMouseEvent) => e.preventDefault();

  const isIcon = barStyle === "icon";
  const extract = mode === "extract";
  const gearTitle = T("标注选项：{detail}", { detail: `${extract ? T("摘录+") : ""}${T(FORM_LABEL[form])}` });
  const gearText = `${extract ? T("摘录·") : ""}${T(FORM_LABEL[form])}`;

  const actBtn = (key: string, label: string, title: string, icon: ReactNode, onClick: () => void, extra?: string) => (
    <button
      key={key}
      type="button"
      className={`sel-btn${isIcon ? " ic" : ""}${extra ? ` ${extra}` : ""}`}
      data-sel-act={key}
      title={title}
      aria-label={label}
      onMouseDown={keepSel}
      onClick={onClick}
    >
      {isIcon ? icon : label}
    </button>
  );

  return (
    <div
      ref={ref}
      className={`menu selection-menu sel-bar${byLocked ? " menu-locked" : ""}`}
      role="dialog"
      aria-label={T("选中文字")}
      data-sel-actions
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 }}
    >
      <div className={`sel-clip${commentOpen ? " open" : ""}`}>
        <div>
          <textarea
            ref={textRef}
            className="menu-comment"
            rows={2}
            placeholder={T("写批注…（Ctrl+Enter 用上次的颜色保存）")}
            aria-label={T("批注内容")}
            tabIndex={commentOpen ? 0 : -1}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                const c = lastColor.current ?? colors[0];
                if (c) pick(c);
              } else if (e.key === "Escape") {
                e.stopPropagation();
                setCommentOpen(false);
              }
            }}
          />
        </div>
      </div>

      <div className="sel-row">
        {colors.length > 0 && (
          <div className="swatches">
            {colors.map((c) => {
              const colorWord = T(COLOR_NAMES[c] ?? c);
              const formWord = T(FORM_LABEL[form]);
              const note = comment.trim() ? T("（附批注）") : "";
              return (
                <button
                  key={c}
                  type="button"
                  className="swatch"
                  data-color={c}
                  title={extract ? T("{color}色 · 摘录+{form}{note}", { color: colorWord, form: formWord, note }) : T("{color}色 · {form}{note}", { color: colorWord, form: formWord, note })}
                  aria-label={T("标注色 {c}", { c })}
                  style={{ background: c.startsWith("#") ? c : `var(--annot-${c})` }}
                  onMouseDown={keepSel}
                  onClick={() => pick(c)}
                />
              );
            })}
          </div>
        )}

        {actions && (
          <>
            <i className="sel-sep" aria-hidden="true" />
            {actBtn("note", T("批注"), T("批注（先写再点颜色）"), <IconSelNote />, toggleComment, commentOpen ? "on" : undefined)}
            {actBtn("manual", T("制卡"), T("就地制卡 · Ctrl+Z"), <IconSelCard />, actions.manual)}
            {actBtn("aiCards", T("AI 制卡"), T("AI 制卡 · Ctrl+X"), <IconSelAiCards />, actions.aiCards)}
            {actBtn("explain", T("AI 解释"), T("AI 解释 · Ctrl+A"), <IconSelExplain />, actions.explain)}
            {actBtn("lookup", T("查词"), T("查词 · Ctrl+D"), <IconSelLookup />, actions.lookup)}
          </>
        )}

        {(onModeChange || onFormChange) && (
          <>
            <i className="sel-sep" aria-hidden="true" />
            <button
              type="button"
              className={`sel-btn sel-gear${optsOpen ? " on" : ""}${extract ? " is-extract" : ""}`}
              data-sel-gear
              title={gearTitle}
              aria-label={gearTitle}
              aria-expanded={optsOpen}
              onMouseDown={keepSel}
              onClick={() => setOptsOpen((o) => !o)}
            >
              {isIcon ? <IconSelMark /> : gearText}
              <span className="sel-chev"><IconSelChevron /></span>
            </button>
            <div className={`sel-ext${optsOpen ? " open" : ""}`} aria-hidden={!optsOpen}>
              <div>
                <i className="sel-sep" aria-hidden="true" />
                <button
                  type="button"
                  className={`sel-btn${extract ? " on" : ""}`}
                  data-annot-extract
                  aria-pressed={extract}
                  tabIndex={optsOpen ? 0 : -1}
                  title={T("点颜色时同时进入学习队列")}
                  onMouseDown={keepSel}
                  onClick={() => onModeChange?.(extract ? "highlight" : "extract")}
                >
                  {T("摘录")}
                </button>
                <span className="sel-seg" role="group" aria-label={T("标记形式")}>
                  {(["highlight", "underline"] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      className={`sel-btn${form === f ? " on" : ""}`}
                      data-annot-form={f}
                      tabIndex={optsOpen ? 0 : -1}
                      onMouseDown={keepSel}
                      onClick={() => onFormChange?.(f)}
                    >
                      {T(FORM_LABEL[f])}
                    </button>
                  ))}
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
