import { useState } from "react";
import { libraryApi, BOOK_LANGUAGES } from "../lib/library";
import { importMany } from "../lib/importRouter";
import { useDialogA11y } from "../lib/dialogA11y";
import { eventBus } from "../lib/eventbus";
import { IconAlert, IconClose, IconImport } from "./icons";

interface Props {
  onSave: (title: string, markdown: string, lang: string) => Promise<void>;
  onClose: () => void;
}

/** 导入结果报告（取代三段 window.alert）：成功/失败分列，失败带原因 */
interface ImportReport {
  okList: { name: string; title?: string }[];
  failList: { name: string; error?: string }[];
}

export default function AddBookModal({ onSave, onClose }: Props) {
  const panelRef = useDialogA11y<HTMLDivElement>(onClose);
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  // v38（D35）：粘贴书的语言（留空=未知，查词时靠句子语境启发）；批量导入的书到书架卡片上设
  const [lang, setLang] = useState("");
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  // M6-3（v30，D27）：批量导入进度（第 done/total 个）
  const [importProgress, setImportProgress] = useState<{ done: number; total: number; current: string } | null>(null);
  const [importReport, setImportReport] = useState<ImportReport | null>(null);
  /** 保存失败的原因。此前这里没有 try/catch：onSave 一 reject，
   * 下面的 setSaving(false) 就永远执行不到 —— 「保存到书架」卡在"保存中…"
   * 且被 disabled 锁死，用户看不到任何报错（异常被 React 当成未处理的 Promise 吞掉）。 */
  const [saveError, setSaveError] = useState<string | null>(null);

  const canSave = markdown.trim().length > 0 && !saving && !importing;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(title, markdown, lang);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  // M6-3（v30，D27）：统一导入入口——一次多选，按扩展名自动路由；逐文件独立成败，聚合报告。
  // 支持：EPUB / PDF / Word / TXT / Markdown / HTML / MOBI / AZW3 / FB2 / CBZ
  async function handleImportFiles() {
    setImporting(true);
    setImportReport(null);
    setSaveError(null);
    try {
      const picked = await libraryApi.pickImportFiles();
      if (!picked || picked.length === 0) return;
      const outcomes = await importMany(picked, (done, total, current) =>
        setImportProgress({ done, total, current })
      );
      const okList = outcomes.filter((o) => o.ok);
      const failList = outcomes.filter((o) => !o.ok);
      if (okList.length > 0) eventBus.emit("library/changed");
      // 全成功 → 直接关窗（与原先一致）。只要有失败，窗口就留着展示报告，
      // 让用户看清是哪几个文件、为什么没进来，而不是被一次 onClose 带走。
      if (failList.length === 0) {
        onClose();
        return;
      }
      setImportReport({
        okList: okList.map((o) => ({ name: o.name, title: o.title })),
        failList: failList.map((o) => ({ name: o.name, error: o.error }))
      });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" ref={panelRef} role="dialog" aria-modal="true" aria-label="添加书籍" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>添加书籍</h2>
          <button className="icon-btn modal-close" title="关闭" aria-label="关闭" onClick={onClose}>
            <IconClose size={18} />
          </button>
        </div>
        <div className="modal-scroll">
        <div className="form-field">
          <label>书名（留空则取正文第一行）</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="输入书名"
            autoFocus
          />
        </div>
        <div className="form-field">
          <label>语言（可选，查词时按它路由词典；留空则查词时自动识别）</label>
          <select value={lang} onChange={(e) => setLang(e.target.value)}>
            {BOOK_LANGUAGES.map((l) => (
              <option key={l.value || "unknown"} value={l.value}>{l.label}</option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label>正文（粘贴文本，支持 Markdown）</label>
          <textarea
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
            placeholder="在这里粘贴你的阅读材料…"
          />
        </div>
        <p className="form-hint">导入支持 EPUB / PDF / Word / TXT / Markdown / HTML / MOBI / AZW3 / FB2 / CBZ，可一次多选批量导入。</p>
        {saveError && (
          <p className="notice-bar card-marked-error" role="alert">
            <IconAlert />
            <span>{saveError}</span>
          </p>
        )}
        {importReport && (
          <div className={`import-report${importReport.failList.length ? " has-fail" : ""}`}>
            <span className="import-report-title">
              导入成功 {importReport.okList.length} 本 · 失败 {importReport.failList.length} 个
            </span>
            {importReport.okList.length > 0 && (
              <ul>
                {importReport.okList.map((o, i) => (
                  <li key={`ok-${i}-${o.name}`}>{o.title || o.name}</li>
                ))}
              </ul>
            )}
            {importReport.failList.length > 0 && (
              <ul>
                {importReport.failList.map((o, i) => (
                  <li key={`fail-${i}-${o.name}`} className="bad">
                    {o.name}（{o.error || "未知原因"}）
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="form-actions">
          <button className="btn btn-outline" disabled={importing || saving} onClick={handleImportFiles}>
            <IconImport />
            {importing
              ? importProgress
                ? `导入中… (${importProgress.done}/${importProgress.total})`
                : "导入中…"
              : "导入文件"}
          </button>
          <span className="form-actions-spacer" />
          <button className="btn btn-secondary" onClick={onClose}>取消</button>
          <button className="btn btn-primary" disabled={!canSave} onClick={handleSave}>
            {saving ? "保存中…" : "保存到书架"}
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}
