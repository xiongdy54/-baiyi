// v48.61（D103，D94 设计稿 §3.2）：「用当前提示词重新生成」确认面板——卡详情发起。
// 源＝该卡来源摘录正文（contextRef.extractId），走既有 cardGenerator.generateCards 管线
// （当前活跃提示词版本；scope 复用原批次、缺省 auto 本地路由）；产物逐张入库/放弃，
// 接受走 createAcceptedCard 完整接受流（CardLint + S1 查重，与 Reader 确认面板同链路）。
// **接受＝新建卡，不覆盖原卡**——原卡及其调度事实原样保留（卡片＝调度单元，覆盖改写
// 会污染「这张卡复习了什么」的历史语义）；siblingKey 走默认推导（与原卡同源同组，管线语义一致）。
import { useEffect, useRef, useState } from "react";
import { cardGenerator, createAcceptedCard, type CardDraft, type CardGenMode, type CardRecord } from "../lib/cards";

/** 浏览器行卡（listAllCards 附带 docTitle） */
type BrowserCardRecord = CardRecord & { docTitle?: string };
import { readingWorkflow } from "../lib/readingWorkflow";
import { eventBus } from "../lib/eventbus";
import { useDialogA11y } from "../lib/dialogA11y";
import { IconAlert } from "./icons";

const KNOWN_SCOPES: ReadonlySet<string> = new Set([
  "card-generation",
  "card-formula",
  "card-seq",
  "card-enum",
  "card-literature",
  "card-mnemonic",
  "card-contrast",
  "card-wording",
  "card-basic",
  "card-occlusion",
  "card-vocab",
  "card-structure"
]);

export default function RegenCardsModal({
  card,
  batchScope,
  onClose
}: {
  card: BrowserCardRecord;
  /** 原批次的提示词 scope（cards:genInfo.batch.scope）；缺失/未知回落 auto 本地路由 */
  batchScope: string | null;
  onClose: () => void;
}) {
  const panelRef = useDialogA11y<HTMLDivElement>(onClose);
  const [running, setRunning] = useState(true);
  const [progress, setProgress] = useState(0);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<CardDraft[] | null>(null);
  const [batchId, setBatchId] = useState<string>("");
  /** 源文本存 ref 供接受时传给 createAcceptedCard（siblingKey 短材料门控的输入，与原管线一致） */
  const sourceTextRef = useRef<string>("");
  const [accepted, setAccepted] = useState<Set<number>>(new Set());
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const mounted = useRef(true);
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
    setBatchId("");
    (async () => {
      try {
        // 源＝该摘录正文（设计稿 §3.2：「源 = 该摘录正文」）；摘录不存在/正文为空即如实报错
        const extractId = card.contextRef?.extractId;
        if (!extractId) throw new Error("该卡没有来源摘录，无法重新生成");
        const extract = await readingWorkflow.getTopic(extractId);
        const sourceText = String(extract?.contentMarkdown ?? "").trim();
        if (!sourceText) throw new Error("来源摘录不存在或正文为空");
        sourceTextRef.current = sourceText;
        const mode: CardGenMode = batchScope && KNOWN_SCOPES.has(batchScope) ? (batchScope as CardGenMode) : "auto";
        const title = card.docTitle || card.sourceRef?.title || undefined;
        const { batchId: newBatchId, result } = await cardGenerator.generateCards(
          sourceText,
          { title, documentId: card.contextRef?.documentId ?? null },
          mode,
          (n) => { if (!cancelled) setProgress(n); },
          () => { if (!cancelled) setThinking(true); }
        );
        if (!cancelled) {
          setBatchId(newBatchId);
          setDrafts(result.cards);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!cancelled) setError(msg.includes("API Key") ? "AI 服务尚未配置：请先在 设置 → AI 服务 中选择服务、粘贴 API Key 并保存。" : msg);
      } finally {
        if (!cancelled) { setRunning(false); setThinking(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [card, batchScope, reloadKey]);

  /** 接受＝新建卡：contextRef 沿用原卡（同一来源锚）、genBatchId 记本次批次；原卡零改动 */
  async function acceptOne(d: CardDraft, i: number) {
    setSaving(true);
    try {
      await createAcceptedCard(d, {
        sourceTitle: card.docTitle || card.sourceRef?.title || null,
        contextRef: card.contextRef,
        sourceText: sourceTextRef.current,
        genBatchId: batchId || null
      });
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
      <div className="modal-panel" ref={panelRef} role="dialog" aria-modal="true" aria-label="用当前提示词重新生成" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>用当前提示词重新生成</h2>
          <button className="icon-btn modal-close" title="关闭" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
        <div className="modal-scroll">
          <p className="form-hint">
            从来源摘录正文按当前活跃提示词重新产卡；接受＝新建卡（原卡与它的复习记录原样保留，是否归档由你决定）。
          </p>
          {running && (
            <p className="form-hint">
              AI 正在按当前提示词重新生成…（{progress} 字）
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
            <p className="form-hint">本次没有产出可接受的卡片（模型未返回草稿）。</p>
          )}
          {!running && !error && (drafts ?? []).map((d, i) => (
            <div key={i} className={`ai-draft ${accepted.has(i) || skipped.has(i) ? "card-fill ai-draft-accepted" : "card-outlined"}`}>
              <div className="ai-draft-front">
                <span className="ai-draft-type mono">{d.cardType}</span>
                {d.contextPrefix && <span className="ai-draft-prefix mono">{d.contextPrefix}</span>}
                <div className="ai-draft-text">{d.front}</div>
              </div>
              <div className="ai-draft-back">{d.back}</div>
              <div className="ai-actions">
                {accepted.has(i) ? (
                  <span className="form-hint state-ok">已入库（新建卡）</span>
                ) : skipped.has(i) ? (
                  <span className="form-hint">已放弃</span>
                ) : (
                  <>
                    <button className="btn btn-primary btn-sm" disabled={saving} onClick={() => void acceptOne(d, i)}>入库</button>
                    <button className="btn btn-secondary btn-sm" disabled={saving} onClick={() => setSkipped(new Set([...skipped, i]))}>放弃</button>
                  </>
                )}
              </div>
            </div>
          ))}
          {!running && !error && drafts !== null && drafts.length > 0 && pendingCount === 0 && (
            <p className="form-hint">全部处理完毕，可关闭。原卡未改动。</p>
          )}
        </div>
      </div>
    </div>
  );
}
