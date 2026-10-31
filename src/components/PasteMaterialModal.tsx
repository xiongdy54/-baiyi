// v49.3（D177）：粘贴材料全窗口编辑器——「添加材料」选单的「粘贴材料」项与全局快捷键
// Ctrl+Alt+N 的共同出口。原 AddBookModal（书名/语言/正文 + 导入文件四合一）拆分后，正文
// 编辑面从 8 行小窗升级为近满窗（variant="full" 无框文档面），书名/语言保留在头行。
// 保存语义与 D160 期逐字相同：受控镜像 onChange 保 canSave 门控、commitOnUnmount=false
// 防关窗误报提交、Esc＝编辑器提交后经 onEscape 走 useDismiss 两步走出场。
import { useRef, useState } from "react";
import { BOOK_LANGUAGES } from "../lib/library";
import { useDialogA11y } from "../lib/dialogA11y";
import { useDismiss } from "../lib/useDismiss";
import { useOverlayBackdrop } from "../lib/overlayDismiss";
import { IconAlert, IconClose } from "./icons";
import MarkdownEditor, { type MarkdownEditorApi } from "./editor/MarkdownEditor";
import { useT } from "../lib/i18n";

interface Props {
  onSave: (title: string, markdown: string, lang: string) => Promise<void>;
  onClose: () => void;
}

export default function PasteMaterialModal({ onSave, onClose }: Props) {
  const T = useT();
  // D120 §8.1：出场两步走——Esc / 遮罩 / 关闭·取消按钮 / 保存成功自动关，全部收口到 requestClose
  const { show, requestClose } = useDismiss(onClose);
  const panelRef = useDialogA11y<HTMLDivElement>(requestClose);
  const backdrop = useOverlayBackdrop(panelRef, requestClose);
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  // 编辑器实例就绪后把光标落到文档末尾（空文档＝开头）：开窗即贴，Ctrl+V 直接可粘
  const mdRef = useRef<MarkdownEditorApi | null>(null);
  // v38（D35）：粘贴书的语言（留空=未知，查词时靠句子语境启发）
  const [lang, setLang] = useState("");
  const [saving, setSaving] = useState(false);
  /** 保存失败的原因（onSave reject 时留窗报错，不关窗） */
  const [saveError, setSaveError] = useState<string | null>(null);

  const canSave = markdown.trim().length > 0 && !saving;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(title, markdown, lang);
      // D120 §8.1：保存成功 → 走 requestClose 两步走出场；失败 catch 留窗报错，不关
      requestClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" data-show={show ? "in" : "out"} {...backdrop}>
      <div className="modal-panel paste-modal" data-show={show ? "in" : "out"} ref={panelRef} role="dialog" aria-modal="true" aria-label={T("粘贴材料")} onClick={(e) => e.stopPropagation()}>
        {/* D177-b（用户反馈）：说明文字退役——书名/语言提示收进 placeholder / aria-label / title，
            头行单行「标题 + 书名框 + 语言选框 + 关闭」垂直居中对齐 */}
        <div className="paste-head">
          <h2>{T("粘贴材料")}</h2>
          <input
            className="paste-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={T("书名（留空取正文第一行）")}
            aria-label={T("书名（留空取正文第一行）")}
          />
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value)}
            aria-label={T("语言（查词按它路由词典；留空自动识别）")}
            title={T("语言（查词按它路由词典；留空自动识别）")}
          >
            {BOOK_LANGUAGES.map((l) => (
              <option key={l.value || "unknown"} value={l.value}>{T(l.label)}</option>
            ))}
          </select>
          <button className="icon-btn modal-close" title={T("关闭")} aria-label={T("关闭")} onClick={requestClose}>
            <IconClose size={18} />
          </button>
        </div>
        <div className="paste-editor">
          <MarkdownEditor
            ref={mdRef}
            value={markdown}
            onChange={setMarkdown}
            onCommit={(t) => {
              if (t !== null) setMarkdown(t);
            }}
            onEscape={() => requestClose()}
            variant="full"
            commitOnUnmount={false}
            placeholder={T("在这里粘贴你的阅读材料…")}
            ariaLabel={T("正文（粘贴文本，支持 Markdown）")}
            onReady={() => mdRef.current?.focusEnd()}
          />
        </div>
        <div className="paste-foot">
          {saveError && (
            <p className="notice-bar card-marked-error" role="alert">
              <IconAlert />
              <span>{saveError}</span>
            </p>
          )}
          <span className="paste-foot-hint">{T("支持 Markdown")}</span>
          <span className="form-actions-spacer" />
          <button className="btn btn-secondary" onClick={requestClose}>{T("取消")}</button>
          <button className="btn btn-primary" disabled={!canSave} onClick={handleSave}>
            {saving ? T("保存中…") : T("保存到书架")}
          </button>
        </div>
      </div>
    </div>
  );
}
