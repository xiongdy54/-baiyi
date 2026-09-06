// 卡片浏览界面（v11.1 用户需求调整）：到期卡片 + 记忆难点 Leech 的浏览与维护入口。
// 复习动作在连续刷题界面（ReviewView）；此处只浏览、筛选、进入 Leech 六步向导。
import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { parseCloze, extractClozeAnswer, cardsApi, type CardRecord } from "../lib/cards";
import { eventBus } from "../lib/eventbus";

type Tab = "due" | "leech";

export default function CardBrowser() {
  const [tab, setTab] = useState<Tab>("due");
  const [dueCards, setDueCards] = useState<(CardRecord & { docTitle?: string })[]>([]);
  const [leechCards, setLeechCards] = useState<CardRecord[]>([]);
  const [leechTarget, setLeechTarget] = useState<CardRecord | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    setDueCards(await cardsApi.listDue());
    setLeechCards(await cardsApi.listLeech());
    setLoaded(true);
  }, []);

  useEffect(() => {
    refresh();
    return eventBus.on("cards/changed", refresh);
  }, [refresh]);

  return (
    <div className="queue-wrap">
      <header className="page-header">
        <div>
          <div className="page-kicker">Cards</div>
          <h1 className="page-title">卡片浏览</h1>
        </div>
        <span className="page-count mono">{dueCards.length} 张到期</span>
      </header>

      <div className="seg-tabs" style={{ padding: "0 var(--sp-8)" }}>
        <button className={tab === "due" ? "active" : ""} onClick={() => setTab("due")}>
          到期卡片
        </button>
        <button className={tab === "leech" ? "active" : ""} onClick={() => setTab("leech")}>
          记忆难点 ({leechCards.length})
        </button>
      </div>

      {tab === "due" && (
        <>
          {loaded && dueCards.length === 0 && (
            <div className="empty-state">
              <div className="empty-deco">
                <span className="empty-sq empty-sq-accent" />
                <span className="empty-sq" />
                <span className="empty-sq" />
              </div>
              <p className="empty-text">没有到期卡片。</p>
            </div>
          )}
          <div className="queue-list">
            {dueCards.map((c) => (
              <div key={c.id} className="queue-row">
                <div className="queue-row-head">
                  <span>{c.cardType === "cloze" ? "填空" : c.cardType === "seq" ? "背诵" : c.cardType === "imageOcclusion" ? "遮挡" : "问答"}
                    {c.docTitle ? ` · 来自《${c.docTitle}》` : ""}
                  </span>
                  <span className="mono">P{c.priority}</span>
                </div>
                <div className="queue-row-text">
                  {c.cardType === "cloze"
                    ? parseCloze(c.frontMarkdown || c.noteText).render(null)
                    : c.frontMarkdown || c.noteText}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === "leech" && (
        <div className="queue-list">
          {leechCards.length === 0 && (
            <div className="empty-state">
              <p className="empty-text">没有记忆难点。连续遗忘 ≥8 次的卡片会出现在这里。</p>
            </div>
          )}
          {leechCards.map((c) => (
            <div key={c.id} className="queue-row">
              <div className="queue-row-head">
                <span>{c.leech?.suspended ? "已暂停" : "处理中"} · 遗忘 {c.fsrs?.lapses ?? 0} 次</span>
                <span className="mono">P{c.priority}</span>
              </div>
              <div className="queue-row-text">{c.frontMarkdown || c.noteText}</div>
              <div className="queue-actions">
                <button className="btn btn-primary btn-sm" onClick={() => setLeechTarget(c)}>
                  六步处理
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {leechTarget && (
        <LeechWizard
          card={leechTarget}
          onClose={() => setLeechTarget(null)}
          onDone={() => {
            setLeechTarget(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

// ---------- 卡面渲染（qa / cloze / seq / imageOcclusion；ReviewView 连续刷题共用） ----------
export function CardFace({
  card,
  showBack,
  onReveal
}: {
  card: CardRecord;
  showBack: boolean;
  onReveal: () => void;
}) {
  const md = (s: string) => (
    <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{s}</ReactMarkdown>
  );

  if (card.cardType === "imageOcclusion" && card.occlusionJson) {
    return (
      <div className="review-face">
        <div className="occlusion-stage">
          <img src={card.occlusionJson.assetPath} alt="" className="occlusion-img" />
          {card.occlusionJson.rects.map((r, i) =>
            i === card.cardOrd || showBack ? (
              <div
                key={i}
                className={`occlusion-rect${showBack ? " occlusion-open" : ""}`}
                style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%` }}
              >
                {showBack ? <span>{r.ord + 1}</span> : null}
              </div>
            ) : (
              <div
                key={i}
                className="occlusion-rect occlusion-hidden"
                style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%` }}
              />
            )
          )}
        </div>
        {showBack && <div className="review-back">{card.backMarkdown}</div>}
        {!showBack && (
          <button className="btn btn-primary" onClick={onReveal}>显示答案</button>
        )}
      </div>
    );
  }

  if (card.cardType === "cloze") {
    const text = card.frontMarkdown || card.noteText;
    const parsed = parseCloze(text);
    const ord = parsed.ords[card.cardOrd] ?? parsed.ords[0];
    return (
      <div className="review-face" onClick={!showBack ? onReveal : undefined}>
        <div className="review-front">
          {card.contextPrefix && <span className="review-prefix mono">{card.contextPrefix}</span>}
          {md(parsed.render(showBack ? null : ord))}
        </div>
        {showBack && (
          <div className="review-back">{md(extractClozeAnswer(text, ord))}</div>
        )}
      </div>
    );
  }

  return (
    <div className="review-face" onClick={!showBack ? onReveal : undefined}>
      <div className="review-front">{md(card.frontMarkdown || card.noteText)}</div>
      {showBack && <div className="review-back">{md(card.backMarkdown)}</div>}
    </div>
  );
}

// ---------- Leech 六步处理向导（§8.7） ----------
export function LeechWizard({ card, onClose, onDone }: { card: CardRecord; onClose: () => void; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [diagnosis, setDiagnosis] = useState<{ diagnosis?: string; analysis?: string; suggestions?: string[] } | null>(null);
  const [running, setRunning] = useState(false);

  async function runDiagnose() {
    setRunning(true);
    try {
      const { cardGenerator } = await import("../lib/cards");
      const { aiGateway } = await import("../lib/ai");
      const tpl = await window.promptsAPI?.get("leech-rescue");
      const raw = await aiGateway.chat(
        [
          { role: "system", content: tpl?.content || "你是记忆难点诊断专家。" },
          {
            role: "user",
            content: `【卡面】\n${card.frontMarkdown || card.noteText}\n\n【答案】\n${card.backMarkdown}\n\n【遗忘次数】${card.fsrs?.lapses ?? 0}\n\n请诊断这张卡反复遗忘的原因，并给出处理建议。`
          }
        ],
        undefined,
        0.4
      );
      let parsed: { diagnosis?: string; analysis?: string; suggestions?: string[] } | null = null;
      try {
        const m = raw.match(/\{[\s\S]*\}/);
        if (m) parsed = JSON.parse(m[0]);
      } catch {
        /* 保留 null，用原文兜底 */
      }
      setDiagnosis(parsed || { analysis: raw });
    } catch (err) {
      setDiagnosis({ analysis: err instanceof Error ? err.message : String(err) });
    } finally {
      setRunning(false);
    }
  }

  const steps = ["诊断", "补卡", "问法", "取舍", "暂缓", "助记"];
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>记忆难点 · 六步处理</h2>
          <button className="icon-btn modal-close" title="关闭" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
        <div className="modal-scroll">
          <div className="seg-tabs" style={{ marginBottom: "var(--sp-4)" }}>
            {steps.map((s, i) => (
              <button key={s} className={step === i ? "active" : ""} onClick={() => setStep(i)}>
                {s}
              </button>
            ))}
          </div>

          <div className="queue-row" style={{ marginBottom: "var(--sp-4)" }}>
            <div className="queue-row-text">{card.frontMarkdown || card.noteText}</div>
            <div className="queue-row-text review-back">{card.backMarkdown}</div>
          </div>

          {step === 0 && (
            <div>
              <p className="form-hint">Step 1 · 明显原因？用 AI 诊断遗忘原因（歧义/干扰/缺前置/过载/是否题残留）。</p>
              <button className="btn btn-primary btn-sm" disabled={running} onClick={runDiagnose}>
                {running ? "诊断中…" : "AI 诊断"}
              </button>
              {diagnosis && (
                <div className="review-mnemonic" style={{ marginTop: "var(--sp-3)" }}>
                  <span className="book-card-label">诊断</span>
                  {diagnosis.diagnosis || diagnosis.analysis}
                  {diagnosis.suggestions && diagnosis.suggestions.length > 0 && (
                    <ul style={{ margin: "var(--sp-2) 0 0", paddingLeft: "1.2em" }}>
                      {diagnosis.suggestions.map((s, i) => <li key={i}>{s}</li>)}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
          {step === 1 && (
            <div>
              <p className="form-hint">Step 2 · 补充卡片。对卡内不熟的术语补前置知识卡；若存在相似卡，生成对比卡区分（需在阅读器选中对应文字后用 AI 制卡）。</p>
            </div>
          )}
          {step === 2 && (
            <div>
              <p className="form-hint">Step 3 · 考察点不对？在阅读器重新选中文本，用「AI 制卡」换一种问法，然后删除或降优先这张卡。</p>
            </div>
          )}
          {step === 3 && (
            <div>
              <p className="form-hint">Step 4 · 不重要？放弃最难的 10% 可换取约 3 倍学习吞吐——删除是理性决策不是失败。</p>
              <div className="settings-row">
                <button
                  className="btn btn-outline btn-sm"
                  onClick={async () => {
                    await cardsApi.remove(card.id);
                    onDone();
                  }}
                >
                  删除这张卡
                </button>
                <button
                  className="btn btn-outline btn-sm"
                  onClick={async () => {
                    await cardsApi.update({ ...card, priority: 20 });
                    onDone();
                  }}
                >
                  降优先级到 20
                </button>
              </div>
            </div>
          )}
          {step === 4 && (
            <div>
              <p className="form-hint">Step 5 · 暂缓？推迟到指定日期自动恢复（备考冲刺期先搁置）。</p>
              <button
                className="btn btn-outline btn-sm"
                onClick={async () => {
                  await cardsApi.update({ ...card, fsrs: { ...card.fsrs, due: Date.now() + 30 * 86400000 } });
                  await cardsApi.updateLeech(card.id, { suspended: true, suspendedAt: Date.now() });
                  onDone();
                }}
              >
                推迟 30 天并暂停
              </button>
            </div>
          )}
          {step === 5 && (
            <div>
              <p className="form-hint">Step 6 · 助记。在阅读器选中卡面关键词用「AI 解释」，把助记方法填入卡片（编辑后重置为新卡）。</p>
            </div>
          )}

          <div className="settings-row" style={{ marginTop: "var(--sp-5)" }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={async () => {
                // 处理完成：重置为新卡 + 清 leech 标记（§8.7 处理后默认重置）
                await cardsApi.update({ ...card, fsrs: { state: "new", due: Date.now(), lapses: 0 } });
                await cardsApi.resolveLeech(card.id, "reworded", {});
                onDone();
              }}
            >
              处理完成 · 重置为新卡
            </button>
            <button
              className="btn btn-outline btn-sm"
              onClick={async () => {
                await cardsApi.setSuspended(card.id, false);
                await cardsApi.resolveLeech(card.id, "resumed", {});
                onDone();
              }}
            >
              仅恢复（不重置）
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
