import { useState } from "react";
import { importEpubFile } from "../lib/epub";
import { libraryApi } from "../lib/library";
import { eventBus } from "../lib/eventbus";

interface Props {
  onSave: (title: string, markdown: string) => Promise<void>;
  onClose: () => void;
}

export default function AddBookModal({ onSave, onClose }: Props) {
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);

  const canSave = markdown.trim().length > 0 && !saving && !importing;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    await onSave(title, markdown);
    setSaving(false);
  }

  async function handleImportEpub() {
    setImporting(true);
    try {
      const result = await importEpubFile();
      if (result) {
        await libraryApi.createFromEpub(result);
        eventBus.emit("library/changed");
        onClose();
      }
    } catch (err) {
      window.alert(`导入失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setImporting(false);
    }
  }

  // M6-1（v26）：Word（含内嵌图）/ TXT / Markdown 导入——pick 取消则静默返回，转换失败弹错
  async function handleImportFile(kind: "word" | "txt" | "markdown" | "pdf") {
    setImporting(true);
    try {
      const picked = await libraryApi.pickImport(kind);
      if (!picked) return;
      const result = await libraryApi.createImported(kind, picked);
      if (result) {
        if (kind === "pdf" && (result.emptyPages ?? 0) > 0) {
          window.alert(`已导入 PDF；其中 ${result.emptyPages} 页无文本层，已按空页跳过。`);
        }
        eventBus.emit("library/changed");
        onClose();
      } else {
        window.alert("导入失败：未能从该文件提取到内容");
      }
    } catch (err) {
      window.alert(`导入失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setImporting(false);
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
          <label>正文（粘贴文本，支持 Markdown）</label>
          <textarea
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
            placeholder="在这里粘贴你的阅读材料…"
          />
        </div>
        <div className="form-actions">
          <button className="btn btn-outline" disabled={importing || saving} onClick={handleImportEpub}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v12" />
              <path d="m8 11 4 4 4-4" />
              <path d="M8 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-4" />
            </svg>
            {importing ? "导入中…" : "导入 EPUB"}
          </button>
          <button className="btn btn-outline" disabled={importing || saving} onClick={() => handleImportFile("word")}>
            导入 Word
          </button>
          <button className="btn btn-outline" disabled={importing || saving} onClick={() => handleImportFile("txt")}>
            导入 TXT
          </button>
          <button className="btn btn-outline" disabled={importing || saving} onClick={() => handleImportFile("markdown")}>
            导入 Markdown
          </button>
          <button className="btn btn-outline" disabled={importing || saving} onClick={() => handleImportFile("pdf")}>
            导入 PDF
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
