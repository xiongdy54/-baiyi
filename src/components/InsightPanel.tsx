// AI 洞察面板（v40，M8-B，D37 / §9.1 M8-B / §4.13）——JournalView 右上「洞察」按钮的模态面板。
// 按需触发（禁后台自动分析）；发送前 Evidence Package 预览（隐私透明）；无 Key 可读降级；
// 输出四分支（Knowledge/Self/Frontier/Structure）；反馈四档只写 insight_runs（永不写 mastery）；
// 去向：就此制卡（createAcceptedCard 复用制卡管线 + CardLint）/ 沉淀 Personal Meaning 候选 / 跳转关联。
import { useCallback, useEffect, useRef, useState } from "react";
import { aiGateway } from "../lib/ai";
import { createAcceptedCard } from "../lib/cards";
import { eventBus } from "../lib/eventbus";
import {
  evidencePackageToMessages,
  insightsApi,
  parseInsightOutput,
  type EvidencePackage,
  type InsightFeedback,
  type InsightOutput,
  type InsightRangeKind,
  type InsightRun,
  type PersonalMeaningCandidate
} from "../lib/insight";

type Step = "range" | "preview" | "running" | "done";

const RANGE_OPTIONS: { value: InsightRangeKind; label: string }[] = [
  { value: "7d", label: "近 7 天" },
  { value: "30d", label: "近 30 天" },
  { value: "all", label: "全部" },
  { value: "custom", label: "自定义" }
];

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function InsightPanel({ onClose, onJumpToDoc }: {
  onClose: () => void;
  onJumpToDoc?: (docId: string, anchor: { anchorText: string }, returnTo?: "browse") => void;
}) {
  const [step, setStep] = useState<Step>("range");
  const [rangeKind, setRangeKind] = useState<InsightRangeKind>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState(todayStr());
  const [pkg, setPkg] = useState<EvidencePackage | null>(null);
  const [run, setRun] = useState<InsightRun | null>(null);
  const [output, setOutput] = useState<InsightOutput | null>(null);
  const [history, setHistory] = useState<InsightRun[]>([]);
  const [feedback, setFeedback] = useState<InsightFeedback>({});
  const [meaningKind, setMeaningKind] = useState<PersonalMeaningCandidate["kind"]>("Value");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [noKey, setNoKey] = useState(false);
  const [streamChars, setStreamChars] = useState(0);
  const [thinkChars, setThinkChars] = useState(0);
  const busyRef = useRef(false);

  const loadHistory = useCallback(async () => {
    setHistory(await insightsApi.listRuns({ limit: 8 }));
  }, []);

  // 无 Key 预检：可读降级而非静默失败（§9.1 M8-B 验收）
  useEffect(() => {
    void (async () => {
      try {
        const cfg = await aiGateway.getConfig();
        setNoKey(!cfg?.hasKey);
      } catch {
        setNoKey(true);
      }
    })();
    void loadHistory();
  }, [loadHistory]);

  async function buildPreview() {
    setError("");
    try {
      const p = await insightsApi.buildPackage({
        rangeKind,
        rangeFrom: rangeKind === "custom" ? customFrom : undefined,
        rangeTo: rangeKind === "custom" ? customTo : undefined
      });
      if (!p) throw new Error("证据包装配失败（主进程不可用）");
      setPkg(p);
      setStep("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function sendToAI() {
    if (!pkg || busyRef.current) return;
    busyRef.current = true;
    setError("");
    setNotice("");
    let localRun: InsightRun | null = null;
    try {
      const tpl = await window.promptsAPI?.get("journal-insight");
      if (!tpl?.content) throw new Error("洞察提示词（journal-insight）未播种");
      localRun = await insightsApi.createRun({
        rangeKind,
        rangeFrom: pkg.range.from,
        rangeTo: pkg.range.to,
        entryCount: pkg.diarySpans.length,
        entryIds: pkg.diarySpans.map((s) => s.entryId),
        evidencePackage: pkg,
        promptScope: "journal-insight"
      });
      if (!localRun) throw new Error("洞察运行记录创建失败");
      setRun(localRun);
      setStep("running");
      setStreamChars(0);
      const { userText } = evidencePackageToMessages(pkg);
      const full = await aiGateway.chat(
        [
          { role: "system", content: tpl.content },
          { role: "user", content: userText }
        ],
        (acc) => setStreamChars(acc.length),
        undefined,
        (n) => setThinkChars(n)
      );
      const parsed = parseInsightOutput(full);
      const done = await insightsApi.completeRun(localRun.id, {
        output: parsed,
        tokenUsed: pkg.tokenEstimated,
        model: (await aiGateway.getConfig())?.model,
        promptVersion: (tpl as unknown as { version?: number }).version ?? undefined
      });
      setRun(done);
      setOutput(parsed);
      setFeedback({});
      setStep("done");
      await loadHistory();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      if (localRun) {
        await insightsApi.failRun(localRun.id, msg);
        setRun(await insightsApi.getRun(localRun.id));
      }
      setStep("done"); // 失败也在 done 视图展示可读错误与反馈面
      await loadHistory();
    } finally {
      busyRef.current = false;
    }
  }

  async function saveFeedback(patch: InsightFeedback) {
    if (!run) return;
    const next = { ...feedback, ...patch };
    setFeedback(next);
    try {
      const updated = await insightsApi.setFeedback(run.id, patch);
      if (updated) setRun(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function makeCard(claim: string, evidence: string[] | undefined) {
    setError("");
    try {
      const ids = await createAcceptedCard(
        {
          cardType: "qa",
          front: claim,
          back: (evidence || []).join("；") || "（无证据记录）",
          contextPrefix: "洞察:",
          sourceRef: { title: `AI 洞察 ${fmtDate(run?.createdAt ?? Date.now())}` },
          prioritySuggestion: 40
        },
        { sourceTitle: "AI 洞察" }
      );
      setNotice(`已入库 ${ids.length} 张卡（经 CardLint，可在「卡片」页查看质检问题）`);
      eventBus.emit("cards/changed");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function saveMeaning(label: string, refs: PersonalMeaningCandidate["evidenceRefs"]) {
    setError("");
    try {
      await insightsApi.meaningCreate({ label, kind: meaningKind, sourceInsightRunId: run?.id, evidenceRefs: refs });
      setNotice(`已沉淀为 Personal Meaning 候选（${meaningKind}），确认后才成事实`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function openDoc(documentId: string | null | undefined, anchorText: string) {
    if (!documentId || !onJumpToDoc) return;
    onJumpToDoc(documentId, { anchorText: anchorText.slice(0, 60) }, "browse");
  }

  // 展示辅助：按 ID 找原文（可点击追溯 = 面板内展开原文 + 有来源时跳转）
  const diaryById = new Map((pkg?.diarySpans ?? []).map((s) => [s.entryId, s]));
  const cardById = new Map((pkg?.cards ?? []).map((c) => [c.cardId, c]));
  const extractById = new Map((pkg?.extracts ?? []).map((e) => [e.extractId, e]));
  const kpById = new Map((pkg?.kpSubgraph.kps ?? []).map((k) => [k.id, k]));

  function RefChip({ kind, id }: { kind: string; id?: string }) {
    if (!id) return null;
    const label =
      kind === "diary" ? `日记 ${diaryById.get(id)?.entryDate ?? ""}` :
      kind === "kp" ? `知识点 ${kpById.get(id)?.canonicalLabel ?? id.slice(0, 8)}` :
      kind === "card" ? `卡片 ${(cardById.get(id)?.front || id).slice(0, 18)}` :
      kind === "extract" ? `摘录 ${(extractById.get(id)?.text || id).slice(0, 18)}` :
      `来源 ${pkg?.sources.find((s) => s.documentId === id)?.title ?? id.slice(0, 8)}`;
    return <span className="ins-ref-chip mono">{label}</span>;
  }

  function EvidenceBlock({ ids }: { ids: { diaryEntryId?: string; knowledgePointId?: string; cardId?: string; extractId?: string; documentId?: string } }) {
    return (
      <div className="ins-evidence">
        {ids.diaryEntryId && (
          <details>
            <summary><RefChip kind="diary" id={ids.diaryEntryId} /> 日记原文</summary>
            <blockquote className="ins-quote">{diaryById.get(ids.diaryEntryId)?.text || "（原文不在本次证据包内）"}</blockquote>
          </details>
        )}
        {ids.knowledgePointId && <RefChip kind="kp" id={ids.knowledgePointId} />}
        {ids.cardId && (
          <details>
            <summary><RefChip kind="card" id={ids.cardId} /> 卡面</summary>
            <blockquote className="ins-quote">
              正面：{cardById.get(ids.cardId)?.front || "—"}<br />
              背面：{cardById.get(ids.cardId)?.back || "—"}
            </blockquote>
          </details>
        )}
        {ids.extractId && (
          <details>
            <summary><RefChip kind="extract" id={ids.extractId} /> 摘录原文</summary>
            <blockquote className="ins-quote">{extractById.get(ids.extractId)?.text || "—"}</blockquote>
          </details>
        )}
        {ids.documentId && (
          <button className="journal-link" onClick={() => openDoc(ids.documentId, cardById.get(ids.cardId ?? "")?.front || "")}>
            打开来源 →
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel ins-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>洞察 · 日记 × 已学知识</h2>
          <button className="icon-btn modal-close" title="关闭" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
        <div className="modal-scroll">
          {noKey && step === "range" && (
            <div className="kmg-msg kmg-msg-error">
              未配置 AI 服务 Key——洞察需要 AI 参与，属可选项。可在 设置 → AI 服务 配置后使用；日记本身不受影响。
            </div>
          )}
          {(error || notice) && (
            <div className={`kmg-msg ${error ? "kmg-msg-error" : ""}`}>
              {error || notice}
              <button className="journal-link" onClick={() => { setError(""); setNotice(""); }}>关闭</button>
            </div>
          )}

          {step === "range" && (
            <div className="ins-step">
              <p className="ins-step-hint">选择洞察范围（按需触发，不会自动分析）：</p>
              <div className="seg-tabs" style={{ padding: 0 }}>
                {RANGE_OPTIONS.map((o) => (
                  <button key={o.value} className={rangeKind === o.value ? "active" : ""} onClick={() => setRangeKind(o.value)}>
                    {o.label}
                  </button>
                ))}
              </div>
              {rangeKind === "custom" && (
                <div className="ins-dates">
                  <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
                  <span className="mono">→</span>
                  <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
                </div>
              )}
              <button className="btn btn-primary" disabled={rangeKind === "custom" && !customFrom} onClick={() => void buildPreview()}>
                装配证据包（预览）
              </button>

              {history.length > 0 && (
                <>
                  <p className="kmg-sec">历史运行</p>
                  <div className="ins-history">
                    {history.map((h) => (
                      <div key={h.id} className="ins-history-row">
                        <span className="mono">{fmtDate(h.createdAt)}</span>
                        <span className="mono">{h.rangeKind}</span>
                        <span className="mono">{h.entryCount} 条</span>
                        <span className={`mono ins-status-${h.status}`}>{h.status === "done" ? "完成" : h.status === "failed" ? "失败" : h.status === "running" ? "进行中" : "取消"}</span>
                        <button
                          className="journal-link"
                          disabled={h.status !== "done"}
                          onClick={() => {
                            setRun(h);
                            setOutput(h.output);
                            setFeedback(h.feedback || {});
                            setPkg(h.evidencePackage);
                            setStep("done");
                          }}
                        >
                          查看
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {step === "preview" && pkg && (
            <div className="ins-step">
              <p className="ins-step-hint">发送前预览——以下内容将发送给 AI（隐私透明，§9.1 M8-B-1）：</p>
              <ul className="ins-pkg-list mono">
                <li>日记 {pkg.diarySpans.length} 条（含原文）</li>
                <li>知识点 {pkg.kpSubgraph.kps.length} 个 · 关系边 {pkg.kpSubgraph.edges.length} 条</li>
                <li>相关卡 {pkg.cards.length} 张 · 相关摘录 {pkg.extracts.length} 条</li>
                <li>来源 {pkg.sources.length} 份</li>
                <li className={pkg.grounded ? "" : "ins-warn"}>
                  预估 token ≈ {pkg.tokenEstimated} / 预算 {pkg.tokenBudget}
                  {!pkg.grounded && "（已按 grounding 优先级裁剪：越靠后的依据先裁）"}
                </li>
              </ul>
              <div className="ins-diary-preview">
                {pkg.diarySpans.slice(0, 6).map((s) => (
                  <p key={s.entryId} className="mono">{s.entryDate} · {s.text.slice(0, 80)}{s.text.length > 80 ? "…" : ""}</p>
                ))}
                {pkg.diarySpans.length === 0 && <p className="mono">（该范围内没有已发送的日记条目）</p>}
              </div>
              <div className="ins-actions">
                <button className="btn btn-outline" onClick={() => setStep("range")}>重选范围</button>
                <button className="btn btn-primary" disabled={noKey || pkg.diarySpans.length === 0 || busyRef.current} onClick={() => void sendToAI()}>
                  {noKey ? "未配置 AI Key" : "发送并生成洞察"}
                </button>
              </div>
              {pkg.diarySpans.length === 0 && <p className="mono ins-warn">范围内没有日记，先生成一条再试。</p>}
            </div>
          )}

          {step === "running" && (
            <div className="ins-step ins-running">
              <p className="mono">AI 思考中…{thinkChars > 0 ? `（已思考 ${thinkChars} 字）` : ""}</p>
              <p className="mono">已接收 {streamChars} 字</p>
              <p className="mono ins-warn">GLM 推理模型首字前可能有约 40 秒静默，属正常现象。</p>
            </div>
          )}

          {step === "done" && run && (
            <div className="ins-step">
              {run.status === "failed" && (
                <div className="kmg-msg kmg-msg-error">本次洞察失败：{run.errorText || "未知错误"}（可重试）</div>
              )}
              {output && (
                <>
                  {output.observation && output.observation.length > 0 && (
                    <>
                      <p className="kmg-sec">观察</p>
                      <ul className="ins-list">
                        {output.observation.map((o, i) => <li key={i}>{o}</li>)}
                      </ul>
                    </>
                  )}
                  {output.knowledgeLinks && output.knowledgeLinks.length > 0 && (
                    <>
                      <p className="kmg-sec">知识关联（点击展开原文）</p>
                      <ul className="ins-list">
                        {output.knowledgeLinks.map((l, i) => (
                          <li key={i}>
                            {l.note || "（无说明）"}
                            <EvidenceBlock ids={l} />
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {output.interpretations && output.interpretations.length > 0 && (
                    <>
                      <p className="kmg-sec">解释（假设 · 点击「选它」参与竞争二选）</p>
                      <ul className="ins-list">
                        {output.interpretations.map((it, i) => (
                          <li key={i} className={feedback.chosenInterpretation === i ? "ins-chosen" : ""}>
                            {it.claim} <span className="mono ins-conf">{it.confidence ? `(${it.confidence})` : ""}</span>
                            {(it.evidence ?? []).map((ev, j) => <p key={j} className="mono ins-ev">依据：{ev}</p>)}
                            <div className="ins-item-actions">
                              <button className="journal-link" onClick={() => void saveFeedback({ chosenInterpretation: i })}>
                                {feedback.chosenInterpretation === i ? "已选 ✓" : "选它"}
                              </button>
                              <button className="journal-link" onClick={() => void makeCard(it.claim, it.evidence)}>就此制卡</button>
                              <button className="journal-link" onClick={() => void saveMeaning(it.claim, (it.evidence ?? []).map((e) => ({ diaryEntryId: undefined, note: e })))}>沉淀为个人意义</button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {output.alternativeInterpretations && output.alternativeInterpretations.length > 0 && (
                    <>
                      <p className="kmg-sec">竞争解释（防确认偏误）</p>
                      <ul className="ins-list">
                        {output.alternativeInterpretations.map((it, i) => (
                          <li key={i}>
                            {it.claim}
                            {(it.evidence ?? []).map((ev, j) => <p key={j} className="mono ins-ev">依据：{ev}</p>)}
                            <div className="ins-item-actions">
                              <button className="journal-link" onClick={() => void makeCard(it.claim, it.evidence)}>就此制卡</button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {output.questions && output.questions.length > 0 && (
                    <>
                      <p className="kmg-sec">追问（缺口已随本次运行记录，K4/K7 接入 Frontier 后可消费）</p>
                      <ul className="ins-list">
                        {output.questions.map((q, i) => (
                          <li key={i}>
                            {q}
                            <span className="ins-item-actions">
                              <button className="journal-link" onClick={() => void makeCard(q, undefined)}>就此制卡</button>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {output.uncertainties && output.uncertainties.length > 0 && (
                    <>
                      <p className="kmg-sec">不确定</p>
                      <ul className="ins-list ins-uncertain">
                        {output.uncertainties.map((u, i) => <li key={i}>{u}</li>)}
                      </ul>
                    </>
                  )}
                  {output.structureConnection && (
                    <>
                      <p className="kmg-sec">结构连接（{output.structureConnection.connectionMode === "analogy" ? "类比" : output.structureConnection.connectionMode === "abstraction" ? "抽象" : "组合"}）</p>
                      <div className="ins-structure">
                        <p>候选领域：<strong>{output.structureConnection.candidateDomain || "—"}</strong></p>
                        <p>已持有结构：{output.structureConnection.ownedStructure?.structureLabel || "—"}{output.structureConnection.ownedStructure?.knowledgePointIds?.length ? `（${output.structureConnection.ownedStructure.knowledgePointIds.map((id) => kpById.get(id)?.canonicalLabel || id.slice(0, 8)).join("、")}）` : ""}</p>
                        <p>{output.structureConnection.whyThisDomain}</p>
                        <table className="ins-mapping">
                          <thead><tr><th>已有知识侧</th><th>候选领域侧</th><th>置信</th></tr></thead>
                          <tbody>
                            {(output.structureConnection.slotMapping ?? []).map((m, i) => (
                              <tr key={i}>
                                <td>{m.fromLabel || kpById.get(m.fromKnowledgePointId ?? "")?.canonicalLabel || m.fromKnowledgePointId || "—"}</td>
                                <td>{m.toLabel}</td>
                                <td className="mono">{m.confidence ?? "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {(output.structureConnection.disanalogy ?? []).length > 0 && (
                          <div>
                            <p className="ins-ev">主要差异（防把类比当同构）：</p>
                            <ul className="ins-list ins-uncertain">{(output.structureConnection.disanalogy ?? []).map((d, i) => <li key={i}>{d}</li>)}</ul>
                          </div>
                        )}
                        {(output.structureConnection.falsifiableQuestions ?? []).length > 0 && (
                          <div>
                            <p className="ins-ev">可证伪追问：</p>
                            <ul className="ins-list">{(output.structureConnection.falsifiableQuestions ?? []).map((q, i) => <li key={i}>{q}</li>)}</ul>
                          </div>
                        )}
                        <div className="ins-item-actions">
                          <button className="journal-link" onClick={() => void saveFeedback({ structureVerdict: "accepted" })}>接受（开始收集该领域材料）</button>
                          <button className="journal-link" onClick={() => void saveFeedback({ structureVerdict: "rejected:invalid" })}>结构不成立</button>
                          <button className="journal-link" onClick={() => void saveFeedback({ structureVerdict: "rejected:uninterested" })}>不感兴趣</button>
                          <button className="journal-link" onClick={() => void saveFeedback({ structureVerdict: "rejected:too-hard" })}>太难</button>
                        </div>
                        {feedback.structureVerdict && <p className="mono">结构反馈已记录：{feedback.structureVerdict}</p>}
                      </div>
                    </>
                  )}
                </>
              )}

              {run.status === "done" && (
                <>
                  <p className="kmg-sec">反馈（只影响洞察效用权重，永不写 mastery）</p>
                  <div className="ins-feedback">
                    {(["useful", "partially-useful", "irrelevant", "uncertain"] as const).map((v) => (
                      <button key={v} className={`btn btn-sm ${feedback.utility === v ? "btn-primary" : "btn-outline"}`} onClick={() => void saveFeedback({ utility: v })}>
                        {v === "useful" ? "有用" : v === "partially-useful" ? "部分有用" : v === "irrelevant" ? "无关" : "不确定"}
                      </button>
                    ))}
                  </div>
                  <p className="kmg-sec">沉淀候选类型</p>
                  <select className="dd-btn" value={meaningKind} onChange={(e) => setMeaningKind(e.target.value as PersonalMeaningCandidate["kind"])}>
                    {(["Concept", "Preference", "Value", "Interest", "Experience", "Question", "Choice"] as const).map((k) => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>
                </>
              )}

              <div className="ins-actions">
                <button className="btn btn-outline" onClick={() => { setStep("range"); setOutput(null); setRun(null); setPkg(null); }}>
                  再来一次
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
