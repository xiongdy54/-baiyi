// v49.3（D177）：导入文件进度/报告模态——「添加材料」选单的「导入文件」项出口。
// 挂载即开文件选择器（取消选择且还没有任何导入结果 → 直接关窗，不闪空模态）；
// 逐文件独立成败的聚合报告沿用原 AddBookModal 的 import-report 呈现：全成功自动关窗，
// 有失败留窗让用户看清是哪几个文件、为什么没进来，并可再次选择文件重试。
import { useEffect, useRef, useState } from "react";
import { libraryApi } from "../lib/library";
import { importMany } from "../lib/importRouter";
import { useDialogA11y } from "../lib/dialogA11y";
import { useDismiss } from "../lib/useDismiss";
import { eventBus } from "../lib/eventbus";
import { IconAlert, IconClose, IconImport } from "./icons";
import { useT } from "../lib/i18n";

/** 导入结果报告（原 AddBookModal 同构）：成功/失败分列，失败带原因 */
interface ImportReport {
  okList: { name: string; title?: string }[];
  failList: { name: string; error?: string }[];
}

interface Props {
  onClose: () => void;
}

export default function ImportFilesModal({ onClose }: Props) {
  const T = useT();
  // D120 §8.1：出场两步走——Esc / 遮罩 / 关闭按钮 / 全部导入成功自动关，收口到 requestClose
  const { show, requestClose } = useDismiss(onClose);
  const panelRef = useDialogA11y<HTMLDivElement>(requestClose);
  const [importing, setImporting] = useState(false);
  // M6-3（v30，D27）：批量导入进度（第 done/total 个）
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 挂载即导一次（选单已确认过意图）；重选文件走同一函数 */
  const startedRef = useRef(false);
  /** 已有导入结果？取消选图时据此决定「直接关窗」还是「留在报告上」 */
  const hasResultRef = useRef(false);

  async function runImport() {
    setImporting(true);
    setReport(null);
    setError(null);
    try {
      const picked = await libraryApi.pickImportFiles();
      if (!picked || picked.length === 0) {
        // 用户取消了文件选择：还没有任何导入结果 → 空窗没意义，直接关；否则留在报告上
        if (!hasResultRef.current) requestClose();
        return;
      }
      const outcomes = await importMany(picked, (done, total, current) =>
        setProgress({ done, total, current })
      );
      const okList = outcomes.filter((o) => o.ok);
      const failList = outcomes.filter((o) => !o.ok);
      if (okList.length > 0) eventBus.emit("library/changed");
      hasResultRef.current = true;
      // 全成功 → 直接关窗（走 requestClose 播出场）。只要有失败，窗口就留着展示，
      // 让用户看清是哪几个文件、为什么没进来，而不是被一次 onClose 带走。
      if (failList.length === 0) {
        requestClose();
        return;
      }
      setReport({
        okList: okList.map((o) => ({ name: o.name, title: o.title })),
        failList: failList.map((o) => ({ name: o.name, error: o.error }))
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
      setProgress(null);
    }
  }

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void runImport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="modal-backdrop" data-show={show ? "in" : "out"} onClick={requestClose}>
      <div className="modal-panel" data-show={show ? "in" : "out"} ref={panelRef} role="dialog" aria-modal="true" aria-label={T("导入文件")} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{T("导入文件")}</h2>
          <button className="icon-btn modal-close" title={T("关闭")} aria-label={T("关闭")} onClick={requestClose}>
            <IconClose size={18} />
          </button>
        </div>
        <div className="modal-scroll">
          {importing ? (
            <p className="form-hint" aria-live="polite">
              {progress
                ? T("导入中… ({done}/{total}) {name}", { done: progress.done, total: progress.total, name: progress.current })
                : T("正在打开文件选择器…")}
            </p>
          ) : (
            report ? (
              <div className="import-report has-fail">
                <span className="import-report-title">
                  {T("导入成功 {n} 本 · 失败 {m} 个", { n: report.okList.length, m: report.failList.length })}
                </span>
                {report.okList.length > 0 && (
                  <ul>
                    {report.okList.map((o, i) => (
                      <li key={`ok-${i}-${o.name}`}>{o.title || o.name}</li>
                    ))}
                  </ul>
                )}
                <ul>
                  {report.failList.map((o, i) => (
                    <li key={`fail-${i}-${o.name}`} className="bad">
                      {/* o.error 是 importRouter 的 zh 稳定文案（纯函数层不依赖 i18n），渲染期取当前语言 */}
                      {o.name}（{o.error ? T(o.error) : T("未知原因")}）
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              !error && <p className="form-hint">{T("正在打开文件选择器…")}</p>
            )
          )}
          {error && (
            <p className="notice-bar card-marked-error" role="alert">
              <IconAlert />
              <span>{error}</span>
            </p>
          )}
          <div className="form-actions">
            <button className="btn btn-outline" disabled={importing} onClick={() => void runImport()}>
              <IconImport />
              {importing ? T("导入中…") : T("导入文件")}
            </button>
            <span className="form-actions-spacer" />
            <button className="btn btn-secondary" onClick={requestClose}>{T("关闭")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
