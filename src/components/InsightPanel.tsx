// AI 洞察面板（v40，M8-B，D37 / §9.1 M8-B / §4.13）——JournalView 右上「洞察」按钮的模态面板。
// 按需触发（禁后台自动分析）；发送前 Evidence Package 预览（隐私透明）；无 Key 可读降级；
// 输出四分支（Knowledge/Self/Frontier/Structure）；反馈四档只写 insight_runs（永不写 mastery）；
// 去向：就此制卡（createAcceptedCard 复用制卡管线 + CardLint）/ 沉淀 Personal Meaning 候选 / 跳转关联。
import { useCallback, useEffect, useRef, useState } from "react";
import { aiConfigUsable, aiGateway } from "../lib/ai";
import { createAcceptedCard } from "../lib/cards";
import { eventBus } from "../lib/eventbus";
import { useDialogA11y } from "../lib/dialogA11y";
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
import { useT } from "../lib/i18n";
import { track } from "../lib/behavior/track";

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
  const T = useT();
  const panelRef = useDialogA11y<HTMLDivElement>(onClose);
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
        // aiConfigUsable：本地预设免 Key（v48.68 / D112——此前只看 hasKey 误判本地配置）
        setNoKey(!aiConfigUsable(cfg));
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
      if (!p) throw new Error(T("证据包装配失败（主进程不可用）"));
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
      if (!tpl?.content) throw new Error(T("洞察提示词（journal-insight）未播种"));
      localRun = await insightsApi.createRun({
        rangeKind,
        rangeFrom: pkg.range.from,
        rangeTo: pkg.range.to,
        entryCount: pkg.diarySpans.length,
        entryIds: pkg.diarySpans.map((s) => s.entryId),
        evidencePackage: pkg,
        promptScope: "journal-insight"
      });
      if (!localRun) throw new Error(T("洞察运行记录创建失败"));
      setRun(localRun);
      setStep("running");
      setStreamChars(0);
      track("insight.viewed", { origin: "reader_internal" });
      const { userText } = evidencePackageToMessages(pkg);
      const full = await aiGateway.chat(
        [
          { role: "system", content: tpl.content },
          { role: "user", content: userText }
        ],
        (acc) => setStreamChars(acc.length),
        undefined,
        (n) => setThinkChars(n),
        undefined,
        "insight"
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
          back: (evidence || []).join("；") || T("（无证据记录）"),
          contextPrefix: T("洞察:"),
          sourceRef: { title: T("AI 洞察 {time}", { time: fmtDate(run?.createdAt ?? Date.now()) }) },
          prioritySuggestion: 40
        },
        { sourceTitle: T("AI 洞察") }
      );
      setNotice(T("已入库 {n} 张卡（经 CardLint，可在「卡片」页查看质检问题）", { n: ids.length }));
      eventBus.emit("cards/changed");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function saveMeaning(label: string, refs: PersonalMeaningCandidate["evidenceRefs"]) {
    setError("");
    try {
      await insightsApi.meaningCreate({ label, kind: meaningKind, sourceInsightRunId: run?.id, evidenceRefs: refs });
      setNotice(T("已沉淀为 Personal Meaning 候选（{kind}），确认后才成事实", { kind: meaningKind }));
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
      kind === "diary" ? T("日记 {date}", { date: diaryById.get(id)?.entryDate ?? "" }) :
      kind === "kp" ? T("知识点 {label}", { label: kpById.get(id)?.canonicalLabel ?? id.slice(0, 8) }) :
      kind === "card" ? T("卡片 {front}", { front: (cardById.get(id)?.front || id).slice(0, 18) }) :
      kind === "extract" ? T("摘录 {text}", { text: (extractById.get(id)?.text || id).slice(0, 18) }) :
      T("来源 {title}", { title: pkg?.sources.find((s) => s.documentId === id)?.title ?? id.slice(0, 8) });
    return <span className="ins-ref-chip mono">{label}</span>;
  }

  function EvidenceBlock({ ids }: { ids: { diaryEntryId?: string; knowledgePointId?: string; cardId?: string; extractId?: string; documentId?: string } }) {
    return (
      <div className="ins-evidence">
        {ids.diaryEntryId && (
          <details>
            <summary><RefChip kind="diary" id={ids.diaryEntryId} /> {T("日记原文")}</summary>
            <blockquote className="ins-quote card-marked">{diaryById.get(ids.diaryEntryId)?.text || T("（原文不在本次证据包内）")}</blockquote>
          </details>
        )}
        {ids.knowledgePointId && <RefChip kind="kp" id={ids.knowledgePointId} />}
        {ids.cardId && (
          <details>
            <summary><RefChip kind="card" id={ids.cardId} /> {T("卡面")}</summary>
            <blockquote className="ins-quote card-marked">
              {T("正面：")}{cardById.get(ids.cardId)?.front || "—"}<br />
              {T("背面：")}{cardById.get(ids.cardId)?.back || "—"}
            </blockquote>
          </details>
        )}
        {ids.extractId && (
          <details>
            <summary><RefChip kind="extract" id={ids.extractId} /> {T("摘录原文")}</summary>
            <blockquote className="ins-quote card-marked">{extractById.get(ids.extractId)?.text || "—"}</blockquote>
          </details>
        )}
        {ids.documentId && (
          <button className="journal-link" onClick={() => openDoc(ids.documentId, cardById.get(ids.cardId ?? "")?.front || "")}>
            {T("打开来源")}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel ins-panel" ref={panelRef} role="dialog" aria-modal="true" aria-label={T("洞察 · 日记与已学知识")} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{T("洞察 · 日记 × 已学知识")}</h2>
          <button className="icon-btn modal-close" title={T("关闭")} onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
        <div className="modal-scroll">
          {noKey && step === "range" && (
            <div className="kmg-msg kmg-msg-error">
              {T("未配置 AI 服务 Key——洞察需要 AI 参与，属可选项。可在 设置 → AI 服务 配置后使用；日记本身不受影响。")}
            </div>
          )}
          {(error || notice) && (
            <div className={`kmg-msg ${error ? "kmg-msg-error" : ""}`}>
              {error || notice}
              <button className="journal-link" onClick={() => { setError(""); setNotice(""); }}>{T("关闭")}</button>
            </div>
          )}

          {step === "range" && (
            <div className="ins-step">
              <p className="ins-step-hint">{T("选择洞察范围（按需触发，不会自动分析）：")}</p>
              <div className="seg-tabs seg-tabs-flush">
                {RANGE_OPTIONS.map((o) => (
                  <button key={o.value} className={rangeKind === o.value ? "active" : ""} onClick={() => setRangeKind(o.value)}>
                    {T(o.label)}
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
                {T("装配证据包（预览）")}
              </button>

              {history.length > 0 && (
                <>
                  <p className="kmg-sec">{T("历史运行")}</p>
                  <div className="ins-history">
                    {history.map((h) => (
                      <div key={h.id} className="ins-history-row">
                        <span className="mono">{fmtDate(h.createdAt)}</span>
                        <span className="mono">{h.rangeKind}</span>
                        <span className="mono">{T("{n} 条", { n: h.entryCount })}</span>
                        <span className={`mono ins-status-${h.status}`}>{h.status === "done" ? T("完成") : h.status === "failed" ? T("失败") : h.status === "running" ? T("进行中") : T("取消")}</span>
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
                          {T("查看")}
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
              <p className="ins-step-hint">{T("发送前预览——以下内容将发送给 AI（隐私透明，§9.1 M8-B-1）：")}</p>
              <ul className="ins-pkg-list mono">
                <li>{T("日记 {n} 条（含原文）", { n: pkg.diarySpans.length })}</li>
                <li>{T("知识点 {n} 个 · 关系边 {m} 条", { n: pkg.kpSubgraph.kps.length, m: pkg.kpSubgraph.edges.length })}</li>
                <li>{T("相关卡 {n} 张 · 相关摘录 {m} 条", { n: pkg.cards.length, m: pkg.extracts.length })}</li>
                <li>{T("来源 {n} 份", { n: pkg.sources.length })}</li>
                <li className={pkg.grounded ? "" : "ins-warn"}>
                  {T("预估 token ≈ {est} / 预算 {budget}", { est: pkg.tokenEstimated, budget: pkg.tokenBudget })}
                  {!pkg.grounded && T("（已按 grounding 优先级裁剪：越靠后的依据先裁）")}
                </li>
              </ul>
              <div className="ins-diary-preview">
                {pkg.diarySpans.slice(0, 6).map((s) => (
                  <p key={s.entryId} className="mono">{s.entryDate} · {s.text.slice(0, 80)}{s.text.length > 80 ? "…" : ""}</p>
                ))}
                {pkg.diarySpans.length === 0 && <p className="mono">{T("（该范围内没有已发送的日记条目）")}</p>}
              </div>
              <div className="ins-actions">
                <button className="btn btn-outline" onClick={() => setStep("range")}>{T("重选范围")}</button>
                <button className="btn btn-primary" disabled={noKey || pkg.diarySpans.length === 0 || busyRef.current} onClick={() => void sendToAI()}>
                  {noKey ? T("未配置 AI Key") : T("发送并生成洞察")}
                </button>
              </div>
              {pkg.diarySpans.length === 0 && <p className="mono ins-warn">{T("范围内没有日记，先生成一条再试。")}</p>}
            </div>
          )}

          {step === "running" && (
            <div className="ins-step ins-running">
              <p className="mono">{T("AI 思考中…")}{thinkChars > 0 ? T("（已思考 {n} 字）", { n: thinkChars }) : ""}</p>
              <p className="mono">{T("已接收 {n} 字", { n: streamChars })}</p>
              <p className="mono ins-warn">{T("GLM 推理模型首字前可能有约 40 秒静默，属正常现象。")}</p>
            </div>
          )}

          {step === "done" && run && (
            <div className="ins-step">
              {run.status === "failed" && (
                <div className="kmg-msg kmg-msg-error">{T("本次洞察失败：{msg}（可重试）", { msg: run.errorText || T("未知错误") })}</div>
              )}
              {output && (
                <>
                  {output.observation && output.observation.length > 0 && (
                    <>
                      <p className="kmg-sec">{T("观察")}</p>
                      <ul className="ins-list">
                        {output.observation.map((o, i) => <li key={i}>{o}</li>)}
                      </ul>
                    </>
                  )}
                  {output.knowledgeLinks && output.knowledgeLinks.length > 0 && (
                    <>
                      <p className="kmg-sec">{T("知识关联（点击展开原文）")}</p>
                      <ul className="ins-list">
                        {output.knowledgeLinks.map((l, i) => (
                          <li key={i}>
                            {l.note || T("（无说明）")}
                            <EvidenceBlock ids={l} />
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {output.interpretations && output.interpretations.length > 0 && (
                    <>
                      <p className="kmg-sec">{T("解释（假设 · 点击「选它」参与竞争二选）")}</p>
                      <ul className="ins-list">
                        {output.interpretations.map((it, i) => (
                          <li key={i} className={feedback.chosenInterpretation === i ? "ins-chosen" : ""}>
                            {it.claim} <span className="mono ins-conf">{it.confidence ? `(${it.confidence})` : ""}</span>
                            {(it.evidence ?? []).map((ev, j) => <p key={j} className="mono ins-ev">{T("依据：")}{ev}</p>)}
                            <div className="ins-item-actions">
                              <button className="journal-link" onClick={() => void saveFeedback({ chosenInterpretation: i })}>
                                {feedback.chosenInterpretation === i ? T("已选") : T("选它")}
                              </button>
                              <button className="journal-link" onClick={() => void makeCard(it.claim, it.evidence)}>{T("就此制卡")}</button>
                              <button className="journal-link" onClick={() => void saveMeaning(it.claim, (it.evidence ?? []).map((e) => ({ diaryEntryId: undefined, note: e })))}>{T("沉淀为个人意义")}</button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {output.alternativeInterpretations && output.alternativeInterpretations.length > 0 && (
                    <>
                      <p className="kmg-sec">{T("竞争解释（防确认偏误）")}</p>
                      <ul className="ins-list">
                        {output.alternativeInterpretations.map((it, i) => (
                          <li key={i}>
                            {it.claim}
                            {(it.evidence ?? []).map((ev, j) => <p key={j} className="mono ins-ev">{T("依据：")}{ev}</p>)}
                            <div className="ins-item-actions">
                              <button className="journal-link" onClick={() => void makeCard(it.claim, it.evidence)}>{T("就此制卡")}</button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {output.questions && output.questions.length > 0 && (
                    <>
                      <p className="kmg-sec">{T("追问（缺口已随本次运行记录，K4/K7 接入 Frontier 后可消费）")}</p>
                      <ul className="ins-list">
                        {output.questions.map((q, i) => (
                          <li key={i}>
                            {q}
                            <span className="ins-item-actions">
                              <button className="journal-link" onClick={() => void makeCard(q, undefined)}>{T("就此制卡")}</button>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {output.uncertainties && output.uncertainties.length > 0 && (
                    <>
                      <p className="kmg-sec">{T("不确定")}</p>
                      <ul className="ins-list ins-uncertain">
                        {output.uncertainties.map((u, i) => <li key={i}>{u}</li>)}
                      </ul>
                    </>
                  )}
                  {output.structureConnection && (
                    <>
                      <p className="kmg-sec">{T("结构连接（{mode}）", { mode: output.structureConnection.connectionMode === "analogy" ? T("类比") : output.structureConnection.connectionMode === "abstraction" ? T("抽象") : T("组合") })}</p>
                      <div className="ins-structure">
                        <p>{T("候选领域：")}<strong>{output.structureConnection.candidateDomain || "—"}</strong></p>
                        <p>{T("已持有结构：")}{output.structureConnection.ownedStructure?.structureLabel || "—"}{output.structureConnection.ownedStructure?.knowledgePointIds?.length ? T("（{list}）", { list: output.structureConnection.ownedStructure.knowledgePointIds.map((id) => kpById.get(id)?.canonicalLabel || id.slice(0, 8)).join("、") }) : ""}</p>
                        <p>{output.structureConnection.whyThisDomain}</p>
                        <table className="ins-mapping">
                          <thead><tr><th>{T("已有知识侧")}</th><th>{T("候选领域侧")}</th><th>{T("置信")}</th></tr></thead>
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
                            <p className="ins-ev">{T("主要差异（防把类比当同构）：")}</p>
                            <ul className="ins-list ins-uncertain">{(output.structureConnection.disanalogy ?? []).map((d, i) => <li key={i}>{d}</li>)}</ul>
                          </div>
                        )}
                        {(output.structureConnection.falsifiableQuestions ?? []).length > 0 && (
                          <div>
                            <p className="ins-ev">{T("可证伪追问：")}</p>
                            <ul className="ins-list">{(output.structureConnection.falsifiableQuestions ?? []).map((q, i) => <li key={i}>{q}</li>)}</ul>
                          </div>
                        )}
                        <div className="ins-item-actions">
                          <button className="journal-link" onClick={() => void saveFeedback({ structureVerdict: "accepted" })}>{T("接受（开始收集该领域材料）")}</button>
                          <button className="journal-link" onClick={() => void saveFeedback({ structureVerdict: "rejected:invalid" })}>{T("结构不成立")}</button>
                          <button className="journal-link" onClick={() => void saveFeedback({ structureVerdict: "rejected:uninterested" })}>{T("不感兴趣")}</button>
                          <button className="journal-link" onClick={() => void saveFeedback({ structureVerdict: "rejected:too-hard" })}>{T("太难")}</button>
                        </div>
                        {feedback.structureVerdict && <p className="mono">{T("结构反馈已记录：")}{feedback.structureVerdict}</p>}
                      </div>
                    </>
                  )}
                </>
              )}

              {run.status === "done" && (
                <>
                  <p className="kmg-sec">{T("反馈（只影响洞察效用权重，永不写 mastery）")}</p>
                  <div className="ins-feedback">
                    {(["useful", "partially-useful", "irrelevant", "uncertain"] as const).map((v) => (
                      <button key={v} className={`btn btn-sm ${feedback.utility === v ? "btn-primary" : "btn-outline"}`} onClick={() => void saveFeedback({ utility: v })}>
                        {v === "useful" ? T("有用") : v === "partially-useful" ? T("部分有用") : v === "irrelevant" ? T("无关") : T("不确定")}
                      </button>
                    ))}
                  </div>
                  <p className="kmg-sec">{T("沉淀候选类型")}</p>
                  <select className="dd-btn" value={meaningKind} onChange={(e) => setMeaningKind(e.target.value as PersonalMeaningCandidate["kind"])}>
                    {(["Concept", "Preference", "Value", "Interest", "Experience", "Question", "Choice"] as const).map((k) => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>
                </>
              )}

              <div className="ins-actions">
                <button className="btn btn-outline" onClick={() => { setStep("range"); setOutput(null); setRun(null); setPkg(null); }}>
                  {T("再来一次")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
