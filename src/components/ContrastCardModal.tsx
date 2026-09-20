// v30（D29 候选增强）：对比卡一键生成确认框——以当前卡为基准，AI 从已有卡语义检索易混卡后
// 走 card-contrast 模板产三件套（A 与 B 的区别 / A 的关键特征 / B 的关键特征），在本框逐张入库/放弃。
// 复习页「对比卡」按钮与卡片浏览 Leech 向导共用；建卡走 createAcceptedCard（与 Reader 确认面板同链路，
// lint + S1 相似检索一致）。
import { useEffect, useRef, useState } from "react";
import { createAcceptedCard, generateContrastDrafts, type CardDraft, type CardRecord } from "../lib/cards";
import { eventBus } from "../lib/eventbus";
import { useDialogA11y } from "../lib/dialogA11y";
import { IconAlert } from "./icons";

export default function ContrastCardModal({ card, onClose }: { card: CardRecord; onClose: () => void }) {
  const panelRef = useDialogA11y<HTMLDivElement>(onClose);
  const [running, setRunning] = useState(true);
  const [progress, setProgress] = useState(0);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<CardDraft[] | null>(null);
  const [accepted, setAccepted] = useState<Set<number>>(new Set());
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const mounted = useRef(true);
  // v34（M12，§4.16）：同一次对比动作入库的对比卡互为同源（act 键）；
  // 显式键优先于锚点推导——对比卡不与基准卡同组（消歧用途，与基准卡同日出现有益，D29）
  const contrastKey = useRef(`act:contrast-${crypto.randomUUID()}`);
  useEffect(() => () => { mounted.current = false; }, []);

  useEffect(() => {
    let cancelled = false;
    setRunning(true);
    setProgress(0);
    setThinking(false);
    setError("");
    setDrafts(null);
    setAccepted(new Set());
    setSkipped(new Set());
    (async () => {
      try {
        const { drafts: result } = await generateContrastDrafts(
          { id: card.id, front: card.frontMarkdown || card.noteText, back: card.backMarkdown, title: card.sourceRef?.title ?? null, domain: card.domain ?? [] },
          (n) => { if (!cancelled) setProgress(n); },
          () => { if (!cancelled) setThinking(true); }
        );
        if (!cancelled) setDrafts(result);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) { setRunning(false); setThinking(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [card, reloadKey]);

  async function acceptOne(d: CardDraft, i: number) {
    setSaving(true);
    try {
      await createAcceptedCard(d, { sourceTitle: card.sourceRef?.title ?? null, contextRef: card.contextRef, siblingKey: contrastKey.current });
      if (!mounted.current) return;
      setAccepted(new Set([...accepted, i]));
      eventBus.emit("cards/changed");
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  const pendingCount = (drafts ?? []).length - accepted.size - skipped.size;
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div className="modal-panel" ref={panelRef} role="dialog" aria-modal="true" aria-label="易混对比卡生成结果" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>易混对比卡 · 基于当前卡生成</h2>
          <button className="icon-btn modal-close" title="关闭" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div className="modal-scroll">
          {running && (
            <p className="form-hint">
              AI 正在从已有卡中检索与当前卡易混的内容并生成对比卡…（{progress} 字）
              {thinking && "（模型思考中，静默数十秒属正常）"}
            </p>
          )}
          {!running && error && (
            <>
              <p className="ai-draft-warnings"><IconAlert size={14} /> {error}</p>
              <div className="ai-actions">
                <button className="btn btn-secondary btn-sm" onClick={() => setReloadKey((k) => k + 1)}>重试</button>
              </div>
            </>
          )}
          {!running && !error && drafts !== null && drafts.length === 0 && (
            <p className="form-hint">AI 认为现有卡片中没有与这张卡存在真实混淆风险的内容，未产对比卡。</p>
          )}
          {!running && !error && (drafts ?? []).map((d, i) => (
            <div key={i} className="ai-draft" style={{ opacity: accepted.has(i) || skipped.has(i) ? 0.5 : 1 }}>
              <div className="ai-draft-front">
                <span className="ai-draft-type mono">{d.cardType}</span>
                {d.contextPrefix && <span className="ai-draft-prefix mono">{d.contextPrefix}</span>}
                <div className="ai-draft-text">{d.front}</div>
              </div>
              <div className="ai-draft-back">{d.back}</div>
              <div className="ai-actions">
                {accepted.has(i) ? (
                  <span className="form-hint">已入库 ✓</span>
                ) : skipped.has(i) ? (
                  <span className="form-hint">已放弃</span>
                ) : (
                  <>
                    <button className="btn btn-primary btn-sm" disabled={saving} onClick={() => acceptOne(d, i)}>入库</button>
                    <button className="btn btn-secondary btn-sm" disabled={saving} onClick={() => setSkipped(new Set([...skipped, i]))}>放弃</button>
                  </>
                )}
              </div>
            </div>
          ))}
          {!running && !error && drafts !== null && drafts.length > 0 && pendingCount === 0 && (
            <p className="form-hint">全部处理完毕，可关闭。</p>
          )}
        </div>
      </div>
    </div>
  );
}
