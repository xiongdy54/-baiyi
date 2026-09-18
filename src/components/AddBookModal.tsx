import { useState } from "react";
import { libraryApi, BOOK_LANGUAGES } from "../lib/library";
import { importMany } from "../lib/importRouter";
import { eventBus } from "../lib/eventbus";

interface Props {
  onSave: (title: string, markdown: string, lang: string) => Promise<void>;
  onClose: () => void;
}

export default function AddBookModal({ onSave, onClose }: Props) {
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  // v38（D35）：粘贴书的语言（留空=未知，查词时靠句子语境启发）；批量导入的书到书架卡片上设
  const [lang, setLang] = useState("");
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  // M6-3（v30，D27）：批量导入进度（第 done/total 个）
  const [importProgress, setImportProgress] = useState<{ done: number; total: number; current: string } | null>(null);

  const canSave = markdown.trim().length > 0 && !saving && !importing;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    await onSave(title, markdown, lang);
    setSaving(false);
  }

  // M6-3（v30，D27）：统一导入入口——一次多选，按扩展名自动路由；逐文件独立成败，聚合报告。
  // 支持：EPUB / PDF / Word / TXT / Markdown / HTML / MOBI / AZW3 / FB2 / CBZ
  async function handleImportFiles() {
    setImporting(true);
    try {
      const picked = await libraryApi.pickImportFiles();
      if (!picked || picked.length === 0) return;
      const outcomes = await importMany(picked, (done, total, current) =>
        setImportProgress({ done, total, current })
      );
      const okList = outcomes.filter((o) => o.ok);
      const failList = outcomes.filter((o) => !o.ok);
      if (okList.length > 0) eventBus.emit("library/changed");
      if (failList.length === 0) {
        window.alert(`已导入 ${okList.length} 本：\n${okList.map((o) => o.title || o.name).join("\n")}`);
        onClose();
      } else if (okList.length === 0) {
        window.alert(`导入失败：\n${failList.map((o) => `${o.name}（${o.error || "未知原因"}）`).join("\n")}`);
      } else {
        window.alert(
          `成功导入 ${okList.length} 本：\n${okList.map((o) => o.title || o.name).join("\n")}\n\n失败 ${failList.length} 个：\n${failList
            .map((o) => `${o.name}（${o.error || "未知原因"}）`)
            .join("\n")}`
        );
        onClose();
      }
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>添加书籍</h2>
          <button className="icon-btn modal-close" title="关闭" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
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
        <div className="form-actions">
          <button className="btn btn-outline" disabled={importing || saving} onClick={handleImportFiles}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v12" />
              <path d="m8 11 4 4 4-4" />
              <path d="M8 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-4" />
            </svg>
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
