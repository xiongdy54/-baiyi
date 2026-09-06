import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { fsrsEngine, type Rating } from "../lib/fsrs";
import { parseCloze, extractClozeAnswer, cardsApi, type CardRecord } from "../lib/cards";
import { eventBus } from "../lib/eventbus";

type Tab = "due" | "leech";

export default function ReviewView() {
  const [tab, setTab] = useState<Tab>("due");
  const [dueCards, setDueCards] = useState<(CardRecord & { docTitle?: string })[]>([]);
  const [leechCards, setLeechCards] = useState<CardRecord[]>([]);
  const [current, setCurrent] = useState<(CardRecord & { docTitle?: string }) | null>(null);
  const [showBack, setShowBack] = useState(false);
  const [startedAt, setStartedAt] = useState(Date.now());
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

  // §11.5（v11）：learning step（1m/10m）到期后无需切视图即应出现，30s 轮询
  useEffect(() => {
    const t = window.setInterval(refresh, 30_000);
    return () => window.clearInterval(t);
  }, [refresh]);

  // 当前卡的四档预览（含同源落库状态）——§11.3：评分复用此结果，预览=落库
  const [previews, setPreviews] = useState<ReturnType<typeof fsrsEngine.preview> | null>(null);

  useEffect(() => {
    setPreviews(current ? fsrsEngine.preview(current.fsrs) : null);
  }, [current]);

  async function openCard(card: CardRecord & { docTitle?: string }) {
    setCurrent(card);
    setShowBack(false);
    setStartedAt(Date.now());
  }

  async function grade(rating: Rating) {
    if (!current) return;
    // §11.3 同源：复用 openCard 时刻缓存的预览结果，按钮显示什么就落库什么
    const previewItem = previews?.find((p) => p.rating === rating);
    const fsrsState = previewItem?.fsrsState ?? fsrsEngine.next(current.fsrs, rating).fsrsState;
    const lapses = fsrsState.lapses ?? 0;
    await cardsApi.review(current.id, fsrsState, rating, Date.now() - startedAt);
    // Leech 检测（§8.7）：lapses >= 8 标记 + 暂停
    // §11.4（v11）：只做字段级 leech 更新，禁止整卡回写（不得覆写刚落库的 fsrs 状态）
    if (fsrsEngine.isLeech(lapses, 8) && !(current.leech?.isLeech)) {
      await cardsApi.addIssue({
        cardId: current.id,
        ruleId: "LEECH",
        severity: "warn",
        message: `连续遗忘 ${lapses} 次，已自动暂停`,
        source: "lint"
      });
      await cardsApi.updateLeech(current.id, { isLeech: true, suspended: true, suspendedAt: Date.now() });
      eventBus.emit("leech/detected", current.id);
    }
    setCurrent(null);
    refresh();
  }

  async function markAndSuspend() {
    if (!current) return;
    await cardsApi.addIssue({
      cardId: current.id,
      ruleId: "MARK",
      severity: "warn",
      message: "复习中标记待改",
      source: "review-mark"
    });
    await cardsApi.setSuspended(current.id, true, "review-mark");
    setCurrent(null);
    refresh();
  }

  if (current) {
    return (
      <div className="review-wrap">
        <CardFace card={current} showBack={showBack} onReveal={() => setShowBack(true)} />
        <div className="review-meta mono">
          {current.docTitle ? `来自《${current.docTitle}》` : ""}
          {current.contextPrefix ? ` · ${current.contextPrefix}` : ""} · 优先级 {current.priority}
          {current.sourceRef?.title ? ` · 来源:${current.sourceRef.title}` : ""}
          {current.dateStamp ? ` · ${current.dateStamp}` : ""}
        </div>
        {showBack && current.mnemonic && (
          <div className="review-mnemonic">
            <span className="book-card-label">助记</span>
            {current.mnemonic}
          </div>
        )}
        {showBack && (
          <>
            <div className="grade-row">
              {(previews ?? fsrsEngine.preview(current.fsrs)).map((p) => (
                <button key={p.rating} className={`btn grade-${p.rating.toLowerCase()}`} onClick={() => grade(p.rating)}>
                  {p.rating}
                  <span className="grade-due mono">{p.dueText}</span>
                </button>
              ))}
            </div>
            <div className="review-tools">
              <button className="btn btn-outline btn-sm" onClick={markAndSuspend}>标记并暂停</button>
            </div>
          </>
        )}
        <button className="btn btn-secondary btn-sm review-exit" onClick={() => setCurrent(null)}>
          结束本轮
        </button>
      </div>
    );
  }

  return (
    <div className="queue-wrap">
      <header className="page-header">
        <div>
          <div className="page-kicker">Review</div>
          <h1 className="page-title">复习</h1>
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
              <p className="empty-text">
                {loaded ? "今日到期卡片已清空。去阅读器里制几张卡吧。" : "加载中…"}
              </p>
            </div>
          )}
          <div className="queue-list">
            {dueCards.map((c) => (
              <div key={c.id} className="queue-row" onClick={() => openCard(c)}>
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

// ---------- 卡面渲染（qa / cloze / seq / imageOcclusion） ----------
function CardFace({
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
function LeechWizard({ card, onClose, onDone }: { card: CardRecord; onClose: () => void; onDone: () => void }) {
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
            content: `正面：${card.frontMarkdown}\n背面：${card.backMarkdown}\n遗忘次数：${card.fsrs?.lapses ?? 0}`
          }
        ],
        undefined,
        0.4
      );
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      setDiagnosis(JSON.parse(raw.slice(start, end + 1)));
    } catch (err) {
      setDiagnosis({ analysis: `AI 诊断失败：${err instanceof Error ? err.message : String(err)}` });
    }
    setRunning(false);
  }

  async function finish(resolution: string, updates?: Record<string, unknown>) {
    await cardsApi.resolveLeech(card.id, resolution, updates);
    eventBus.emit("cards/changed");
    onDone();
  }

  const steps = ["诊断", "补卡/对比", "重设问法", "删除/降优先", "暂缓", "助记"];

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

        <div className="wizard-steps mono">
          {steps.map((s, i) => (
            <span key={s} className={i === step ? "wizard-step-active" : ""}>
              {i + 1}. {s}
            </span>
          ))}
        </div>

        <div className="ai-quote">{card.frontMarkdown}</div>
        <div className="ai-quote">{card.backMarkdown}</div>

        {step === 0 && (
          <div>
            <p className="form-hint">卡片连续遗忘 {card.fsrs?.lapses ?? 0} 次。先看明显原因（历史 lint 问题、相似卡），或用 AI 诊断。</p>
            <button className="btn btn-primary" disabled={running} onClick={runDiagnose}>
              {running ? "诊断中…" : "AI 诊断"}
            </button>
            {diagnosis && (
              <div className="ai-answer">
                <p><strong>{diagnosis.diagnosis}</strong></p>
                <p>{diagnosis.analysis}</p>
                <ul>{diagnosis.suggestions?.map((s, i) => <li key={i}>{s}</li>)}</ul>
              </div>
            )}
            <div className="form-actions">
              <button className="btn btn-primary" onClick={() => setStep(1)}>下一步</button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div>
            <p className="form-hint">补前置知识卡，或对相似概念产对比卡（AI）。</p>
            <div className="form-actions">
              <button className="btn btn-secondary" onClick={() => setStep(2)}>跳过</button>
              <button
                className="btn btn-primary"
                onClick={async () => {
                  const { cardGenerator } = await import("../lib/cards");
                  const { result } = await cardGenerator.generateCards(
                    `术语：${card.frontMarkdown}\n解释：${card.backMarkdown}`,
                    {},
                    "card-basic"
                  );
                  for (const d of result.cards) {
                    await cardsApi.create({
                      noteText: d.front,
                      cardType: d.cardType,
                      frontMarkdown: d.front,
                      backMarkdown: d.back,
                      contextPrefix: d.contextPrefix || "前置:",
                      priority: d.prioritySuggestion ?? 70,
                      generatedBy: "ai"
                    });
                  }
                  eventBus.emit("cards/changed");
                  setStep(2);
                }}
              >
                AI 生成前置卡
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <p className="form-hint">考察点不对？让 AI 给出替代问法。</p>
            <div className="form-actions">
              <button className="btn btn-secondary" onClick={() => setStep(3)}>跳过</button>
              <button
                className="btn btn-primary"
                onClick={async () => {
                  const { cardGenerator } = await import("../lib/cards");
                  const { result } = await cardGenerator.generateCards(
                    `原正面：${card.frontMarkdown}\n原背面：${card.backMarkdown}`,
                    {},
                    "card-wording"
                  );
                  const alt = result.cards[0];
                  if (alt) await finish("reworded", { frontMarkdown: alt.front, backMarkdown: alt.back });
                }}
              >
                AI 重设问法（直接应用）
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <p className="form-hint">放弃最难的 10% 可换取约 3 倍学习吞吐——删除是理性决策不是失败。</p>
            <div className="form-actions">
              <button className="btn btn-secondary" onClick={() => setStep(4)}>跳过</button>
              <button
                className="btn btn-primary"
                onClick={async () => {
                  await cardsApi.remove(card.id);
                  eventBus.emit("cards/changed");
                  onDone();
                }}
              >
                删除这张卡
              </button>
              <button
                className="btn btn-outline"
                onClick={async () => {
                  await finish("deprioritized", { priority: 90 });
                }}
              >
                降优先级
              </button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div>
            <p className="form-hint">备考冲刺期可先搁置：卡片挂起，到指定天数后自动恢复。</p>
            <div className="form-actions">
              <button className="btn btn-secondary" onClick={() => setStep(5)}>跳过</button>
              {[7, 30].map((days) => (
                <button
                  key={days}
                  className="btn btn-outline"
                  onClick={async () => {
                    await cardsApi.update({
                      ...card,
                      leech: { isLeech: true, suspended: true, suspendedAt: Date.now(), postponeDays: days }
                    });
                    await finish("postponed");
                  }}
                >
                  推迟 {days} 天
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 5 && (
          <div>
            <p className="form-hint">为这张卡生成助记双卡（助记本身 + 用助记引导答案）。</p>
            <div className="form-actions">
              <button
                className="btn btn-secondary"
                onClick={async () => {
                  await finish("none");
                }}
              >
                跳过（仅重置为新卡）
              </button>
              <button
                className="btn btn-primary"
                onClick={async () => {
                  const { cardGenerator } = await import("../lib/cards");
                  const { result } = await cardGenerator.generateCards(
                    `正面：${card.frontMarkdown}\n背面：${card.backMarkdown}`,
                    {},
                    "card-mnemonic"
                  );
                  let mnemonicText = "";
                  for (const d of result.cards) {
                    if (d.mnemonic) mnemonicText = d.mnemonic;
                    await cardsApi.create({
                      noteText: d.front,
                      cardType: "mnemonic",
                      frontMarkdown: d.front,
                      backMarkdown: d.back,
                      contextPrefix: d.contextPrefix || "助记:",
                      priority: 60,
                      generatedBy: "ai",
                      mnemonic: d.mnemonic
                    });
                  }
                  eventBus.emit("cards/changed");
                  await finish("mnemonic", { mnemonic: mnemonicText });
                }}
              >
                AI 生成助记双卡并重置
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
