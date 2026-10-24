// 卡片字段编辑器（C-34b：从 ManualCardEditor.tsx **原样搬出**并 export——制卡台与复习页/浏览器
// 卡面（EditableField）共用同一套字段编辑器，契约见 docs/EDIT-CONTRACT.md）：
//  · MdField —— 问答字段（Milkdown 紧凑档）；ClozeField —— 填空源文本（textarea + 挖空工具行，
//    挖空工具要操作原始文本选区，故保留 textarea，进白名单）；
//  · ClozeDraftEditor —— C-34b 新增：EditableField 的填空接法——内部草稿 state，
//    失焦 / Ctrl+Enter / Esc 提交（onDone），挂载即聚焦 textarea。
// 搬出为纯移动（零行为改动）；GrowField 是 ClozeField 的容器依赖，随之同迁。
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { isImeComposing } from "../../lib/ime";
import { parseCloze } from "../../lib/cards";
import { growTextarea, useGrowBox } from "../../lib/autoGrow";
import MarkdownEditor from "./MarkdownEditor";
import { useT } from "../../lib/i18n";

/** §J P0（#4）：制卡表单字段统一 Markdown 紧凑档（无工具条、矮盒 minRows=2）。
    onChange 实时镜像（canSave 门控与挖空预览保持逐键响应）；提交语义不需要（表单保存走「创建卡片」），
    onCommit 置空——失焦提交只做镜像核对，不写库（落库链零新通道）。 */
export function MdField({
  value,
  onChange,
  placeholder,
  label,
  minRows = 2
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label?: string;
  minRows?: number;
}) {
  return (
    <MarkdownEditor
      value={value}
      variant="compact"
      toolbar={false}
      minRows={minRows}
      placeholder={placeholder}
      ariaLabel={label}
      onChange={onChange}
      onCommit={() => {}}
    />
  );
}


/** 制卡台输入字段外壳（D123 修订）：默认一行、随内容伸缩（高度过渡由 CSS 的 --dur-panel/--ease 承担）；
    右下角可选「带入…」悬停钮（设计稿绿色小字）：点击把外部文本写入该字段；无外部文本但有 generate
    （v48.101/D146「带入 AI 回答」生成链）时点击触发生成（busy 期间显示「生成中…」并忽略再点）。
    D144 #4（§3.3）：可选幽灵草稿层（宿主构建的节点）——absolute 铺满 field 输入面；
    v48.101（D146 修订）：幽灵层 pointer-events:none 纯指示，接受唯一路径＝Alt+Enter
    （坞内固定键，目标输入面聚焦时走 onGhostAccept），点击不再接受。 */
export function GrowField({
  children,
  pick,
  ghost,
  onGhostAccept
}: {
  children: ReactNode;
  pick?: { label: string; empty: string; get: () => string | null | undefined; apply: (t: string) => void; generate?: () => void; busy?: boolean };
  ghost?: ReactNode;
  onGhostAccept?: () => void;
}) {
  const T = useT();
  const [clipRef, innerRef] = useGrowBox<HTMLDivElement, HTMLDivElement>(168);
  const [miss, setMiss] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  return (
    <div
      className="wb-field"
      onKeyDown={
        ghost && onGhostAccept
          ? (e: React.KeyboardEvent) => {
              // 与 Ctrl+Enter（制卡）/Ctrl+Shift+C（挖空）无冲突（altKey 互斥）；IME 组合态不接管
              if (e.altKey && e.key === "Enter" && !isImeComposing(e)) {
                e.preventDefault();
                onGhostAccept();
              }
            }
          : undefined
      }
    >
      <div className="wb-field-clip" ref={clipRef}>
        <div className="wb-field-inner" ref={innerRef}>{children}</div>
        {ghost}
      </div>
      {pick && (
        <button
          type="button"
          className={`wb-pick reveal-on-hover${miss ? " is-miss" : ""}`}
          // 不抢焦点/选区：mousedown 阻止默认，读选区时阅读区选区仍在
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (pick.busy) return;
            const t = (pick.get() ?? "").trim();
            if (t) {
              pick.apply(t);
              return;
            }
            // v48.101（D146）：无既有文本但有生成链（正面非空）→ 触发生成；否则空态提示
            if (pick.generate) {
              pick.generate();
              return;
            }
            setMiss(true);
            if (timer.current) window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => setMiss(false), 1400);
          }}
        >
          {pick.busy ? T("生成中…") : miss ? pick.empty : pick.label}
        </button>
      )}
    </div>
  );
}

/** Anki 语义的挖空标记：编号取现有最大值 +1（新题）或沿用最大值（同题多空） */
function nextClozeOrd(text: string, sameCard: boolean): number {
  const ords = parseCloze(text).ords;
  const max = ords.length ? ords[ords.length - 1] : 0;
  return sameCard ? Math.max(1, max) : max + 1;
}

/** 以选区（textarea 的 selectionStart/End）包上 {{cN::…}}；返回新文本与新选区 */
function wrapCloze(text: string, start: number, end: number, ord: number): { text: string; caret: [number, number] } | null {
  if (start === end) return null;
  const inner = text.slice(start, end);
  const open = `{{c${ord}::`;
  const next = text.slice(0, start) + open + inner + "}}" + text.slice(end);
  return { text: next, caret: [start + open.length, start + open.length + inner.length] };
}

/** 取消挖空：选区/光标落在某个 {{cN::x}} 内 → 还原成 x（只拆一个，最内层命中者） */
function unwrapCloze(text: string, pos: number): { text: string; caret: number } | null {
  const re = /\{\{c\d+::([\s\S]*?)(?:::[\s\S]*?)?\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (pos >= m.index && pos <= m.index + m[0].length) {
      return { text: text.slice(0, m.index) + m[1] + text.slice(m.index + m[0].length), caret: m.index + m[1].length };
    }
  }
  return null;
}

/** 填空字段：纯文本 textarea（能可靠读写选区），一行起步随内容伸缩；工具行＝挖空 / 同题挖空 / 取消挖空 + 实时「N 张卡 · M 个空」
    D144 #4：幽灵层/接受回调透传给首字段 GrowField（填空题的第一文本框＝挖空文本）。 */
export function ClozeField({ value, onChange, onPick, ghost, onGhostAccept }: { value: string; onChange: (v: string) => void; onPick?: { label: string; get: () => string | null | undefined }; ghost?: ReactNode; onGhostAccept?: () => void }) {
  const T = useT();
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const pendingCaret = useRef<[number, number] | null>(null);
  const [hasSel, setHasSel] = useState(false);
  const [inBlank, setInBlank] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    growTextarea(el, 168);
    if (pendingCaret.current) {
      el.focus({ preventScroll: true });
      el.setSelectionRange(pendingCaret.current[0], pendingCaret.current[1]);
      pendingCaret.current = null;
    }
  }, [value]);
  const sync = () => {
    const el = ref.current;
    if (!el) return;
    setHasSel(el.selectionStart !== el.selectionEnd);
    setInBlank(!!unwrapCloze(el.value, el.selectionStart));
  };
  const apply = (sameCard: boolean) => {
    const el = ref.current;
    if (!el) return;
    const r = wrapCloze(value, el.selectionStart, el.selectionEnd, nextClozeOrd(value, sameCard));
    if (!r) return;
    pendingCaret.current = r.caret;
    onChange(r.text);
  };
  const remove = () => {
    const el = ref.current;
    if (!el) return;
    const r = unwrapCloze(value, el.selectionStart);
    if (!r) return;
    pendingCaret.current = [r.caret, r.caret];
    onChange(r.text);
  };
  const ords = parseCloze(value).ords;
  const blanks = (value.match(/\{\{c\d+::/g) ?? []).length;
  // 工具钮 mousedown 阻止默认：点击不夺走 textarea 焦点，选区得以保留
  const keep = (e: React.MouseEvent) => e.preventDefault();
  return (
    <>
      <GrowField ghost={ghost} onGhostAccept={onGhostAccept} pick={onPick ? { label: onPick.label, empty: T("没有选区"), get: onPick.get, apply: (t) => onChange(t) } : undefined}>
        <textarea
          ref={ref}
          className="wb-cloze-input"
          rows={1}
          value={value}
          aria-label={T("挖空文本")}
          placeholder={T("输入一段话，选中文字后点「挖空」")}
          onChange={(e) => onChange(e.target.value)}
          onSelect={sync}
          onKeyUp={sync}
          onMouseUp={sync}
          onKeyDown={(e) => {
            // Anki 快捷键：Ctrl+Shift+C 挖空（新题）；Ctrl+Alt+Shift+C 同题挖空
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "c") {
              e.preventDefault();
              apply(e.altKey);
            }
          }}
        />
      </GrowField>
      <div className="wb-cloze-bar">
        <button type="button" className="wb-cloze-btn" disabled={!hasSel} onMouseDown={keep} onClick={() => apply(false)} title={T("选中文字后点击：新建一题（c1、c2…，Ctrl+Shift+C）")}>
          {T("挖空")}
        </button>
        <button type="button" className="wb-cloze-btn" disabled={!hasSel || ords.length === 0} onMouseDown={keep} onClick={() => apply(true)} title={T("与上一个挖空同属一题，复习时一起遮（Ctrl+Alt+Shift+C）")}>
          {T("同题挖空")}
        </button>
        <button type="button" className="wb-cloze-btn" disabled={!inBlank} onMouseDown={keep} onClick={remove} title={T("光标放在某个挖空里，点击还原为普通文字")}>
          {T("取消挖空")}
        </button>
        <span className="wb-cloze-stat mono" aria-live="polite">
          {blanks === 0 ? T("尚无挖空") : T("{cards} 张卡 · {blanks} 个空", { cards: ords.length, blanks })}
        </span>
      </div>
    </>
  );
}

/** C-34b：填空源文本编辑器的草稿包装（EditableField 的 renderEditor 接法）。
    受控 ClozeField + 内部草稿 state——「提交语义」在包装层收口（契约 docs/EDIT-CONTRACT.md）：
    失焦（焦点离开整个字段，含挖空工具行）/ Ctrl+Enter / Esc 都走 onDone(draft)——
    内容未变时由 EditableField 幂等短路；挂载即聚焦 textarea（点击进入编辑即落焦点）。
    IME 组字中的 Esc / Ctrl+Enter 属于输入法，不提交。 */
export function ClozeDraftEditor({ value, onDone }: { value: string; onDone: (next: string | null) => void }) {
  const [draft, setDraft] = useState(value);
  const boxRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    boxRef.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus({ preventScroll: true });
  }, []);
  return (
    <div
      ref={boxRef}
      className="cloze-draft-editor"
      onBlur={(e) => {
        // relatedTarget 在字段内部（Tab 到挖空工具钮）＝焦点没走，不提交
        if (!e.currentTarget.contains(e.relatedTarget as Node)) onDone(draft);
      }}
      onKeyDownCapture={(e) => {
        if (isImeComposing(e)) return;
        if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          onDone(draft);
        }
      }}
    >
      <ClozeField value={draft} onChange={setDraft} />
    </div>
  );
}
