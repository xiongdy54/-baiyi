// D121 §3 卡片辨析弹窗（替换 v30 ContrastCardModal）。
// 第一步（纯本地，无 AI 也完整可用）：选另一张卡 / 单卡模式；第二步：左右并排编辑 A、B，
// 「保存修改」逐卡落库；「AI 诊断」点击才调用（card-disambiguate v1，出层校验在 disambiguateCore）。
// 不碰 FSRS：修改问题不重置调度；归档走 cardsApi.batch("archive")（D102 语义）。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { aiConfigUsable, aiGateway } from "../lib/ai";
import { cardsApi, generateContrastDrafts, applyCardTextEdit, type CardRecord } from "../lib/cards";
import { cardLinksApi } from "../lib/cardLinks";
import {
  bigramJaccard,
  buildDisambiguateInput,
  rankDisambiguationCandidates,
  validateDisambiguateOutput,
  type DisambiguateFix,
  type DisambiguateResult,
  type DisambiguateSide
} from "../lib/disambiguateCore.mjs";
import {
  fieldsChanged,
  fieldsOfCard,
  isBigFrontChange,
  NOTE_MAX,
  type EditableFields,
  type Side
} from "../lib/disambiguateUi";
import { useDialogA11y } from "../lib/dialogA11y";
import { eventBus } from "../lib/eventbus";
import CandidatePicker from "./disambiguate/CandidatePicker";
import CardPane from "./disambiguate/CardPane";
import Footer from "./disambiguate/Footer";
import DiagnosisPanel, { fixKey, type ContrastState } from "./disambiguate/DiagnosisPanel";
import { loadOrigin, sourceOf, type CardWithTitle } from "./disambiguate/shared";
import { IconAlert } from "./icons";

export interface DisambiguateCloseResult {
  changed: boolean;
  archivedIds: string[];
  /** origin="review" 且「关闭后跳过本卡」勾选时为 true（ReviewView 据此调既有 skip()） */
  skipRequested?: boolean;
}

type SideData = { card: CardWithTitle; orig: EditableFields; cur: EditableFields };

const EMPTY_CONTRAST: ContrastState = { running: false, progress: 0, thinking: false, error: "", drafts: null };
const NO_KEY_HINT = "未配置 AI 服务 Key：请先在 设置 → AI 服务 中配置后再使用「AI 诊断」（手动修改与保存不受影响）。";

function toSide(card: CardWithTitle): SideData {
  const f = fieldsOfCard(card);
  return { card, orig: f, cur: f };
}

function sideInput(s: SideData, origin: string | null | undefined): DisambiguateSide {
  const src = sourceOf(s.card);
  return {
    prefix: s.cur.contextPrefix,
    front: s.cur.front,
    back: s.cur.back,
    sourceTitle: src.title,
    author: src.author,
    anchor: src.anchor,
    original: origin ?? ""
  };
}

export default function DisambiguateModal({
  card,
  presetOther,
  origin,
  onClose
}: {
  card: CardRecord;
  presetOther?: string;
  origin: "review" | "browser" | "manual";
  onClose: (result: DisambiguateCloseResult) => void;
}) {
  // ---- 会话状态 ----
  const [all, setAll] = useState<CardWithTitle[]>([]);
  const [loadingAll, setLoadingAll] = useState(true);
  const [step, setStep] = useState<"pick" | "compare">(presetOther ? "compare" : "pick");
  const [a, setA] = useState<SideData>(() => toSide(card as CardWithTitle));
  const [b, setB] = useState<SideData | null>(null);
  const [single, setSingle] = useState(false);
  const [originA, setOriginA] = useState<string | null | undefined>(undefined);
  const [originB, setOriginB] = useState<string | null | undefined>(undefined);
  const [adopted, setAdopted] = useState<Set<string>>(new Set());
  const [archivedSides, setArchivedSides] = useState<Set<Side>>(new Set());
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [aiUsable, setAiUsable] = useState<boolean | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const [result, setResult] = useState<DisambiguateResult | null>(null);
  const [snapshot, setSnapshot] = useState<{ A: EditableFields; B: EditableFields | null } | null>(null);
  const [contrast, setContrast] = useState<ContrastState>(EMPTY_CONTRAST);
  const [skipAfter, setSkipAfter] = useState(true);

  const mounted = useRef(true);
  const changedRef = useRef(false);
  const archivedIdsRef = useRef<string[]>([]);
  const linkIdRef = useRef<string | null>(null);
  const linkBusyRef = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => () => { mounted.current = false; }, []);

  const close = useCallback(() => {
    onClose({
      changed: changedRef.current,
      archivedIds: [...archivedIdsRef.current],
      ...(origin === "review" ? { skipRequested: skipAfter } : {})
    });
  }, [onClose, origin, skipAfter]);
  const panelRef = useDialogA11y<HTMLDivElement>(close);

  // ---- 加载：全部卡 + AI 可用性 + A 的原文（打开即显示，均为本地读；无网络调用） ----
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await cardsApi.listAll();
        if (cancelled) return;
        setAll(list);
        if (presetOther) {
          const hit = list.find((c) => c.id === presetOther) ?? ((await cardsApi.get(presetOther)) as CardWithTitle | null);
          if (cancelled) return;
          if (hit) setB(toSide(hit));
          else setStep("pick");
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoadingAll(false);
      }
    })();
    void aiGateway
      .getConfig()
      .then((cfg) => { if (!cancelled) setAiUsable(aiConfigUsable(cfg)); })
      .catch(() => { if (!cancelled) setAiUsable(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadOrigin(card).then((t) => { if (!cancelled) setOriginA(t); });
    return () => { cancelled = true; };
  }, [card]);

  const bId = b?.card.id;
  useEffect(() => {
    if (!b) { setOriginB(undefined); return; }
    let cancelled = false;
    setOriginB(undefined);
    void loadOrigin(b.card).then((t) => { if (!cancelled) setOriginB(t); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bId]);

  const ranked = useMemo(() => rankDisambiguationCandidates(card, all, 5), [card, all]);

  // ---- 第一步 → 第二步 ----
  function pick(c: CardWithTitle) {
    setB(toSide(c));
    setSingle(false);
    resetDiagnosis();
    setStep("compare");
  }
  function pickSingle() {
    setB(null);
    setSingle(true);
    resetDiagnosis();
    setStep("compare");
  }
  function backToPick() {
    setStep("pick");
    resetDiagnosis();
    setNotice("");
  }
  function resetDiagnosis() {
    // 换了对照卡（或单卡）＝新的辨析对象：旧链接属于上一对卡，不再复用
    linkIdRef.current = null;
    setResult(null);
    setSnapshot(null);
    setAdopted(new Set());
    setContrast(EMPTY_CONTRAST);
    setError("");
  }

  const hasB = !!b && !single;
  const dirtyA = fieldsChanged(a.orig, a.cur);
  const dirtyB = !!b && fieldsChanged(b.orig, b.cur);
  const dirty = dirtyA || dirtyB;

  function patchSide(side: Side, patch: Partial<EditableFields>) {
    if (side === "A") setA((s) => ({ ...s, cur: { ...s.cur, ...patch } }));
    else setB((s) => (s ? { ...s, cur: { ...s.cur, ...patch } } : s));
  }

  // ---- card_links：同一弹窗会话只写一条（后续更新同 id）；失败静默（展示/溯源用，不阻塞主流程） ----
  function writeLink(verdict: Parameters<typeof cardLinksApi.add>[0]["verdict"], note: string) {
    const trimmed = Array.from(note).slice(0, NOTE_MAX).join("");
    linkBusyRef.current = linkBusyRef.current.then(async () => {
      try {
        if (linkIdRef.current) {
          await cardLinksApi.update(linkIdRef.current, { verdict, note: trimmed });
        } else {
          const id = await cardLinksApi.add({ cardA: a.card.id, cardB: hasB && b ? b.card.id : null, verdict, note: trimmed });
          if (id) linkIdRef.current = id;
        }
      } catch {
        /* 静默 */
      }
    });
    return linkBusyRef.current;
  }

  // ---- 保存修改：逐卡 cardsApi.update（全行更新 → 先取最新行再并入编辑字段，绝不碰 FSRS） ----
  async function saveOne(side: SideData): Promise<boolean> {
    const fresh = ((await cardsApi.get(side.card.id)) as CardWithTitle | null) ?? side.card;
    const next = applyCardTextEdit(fresh, side.cur);
    return !!(await cardsApi.update(next));
  }

  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      let bigChange = false;
      const saved: Side[] = [];
      if (dirtyA) {
        if (!(await saveOne(a))) throw new Error("保存卡 A 失败");
        saved.push("A");
        if (isBigFrontChange(bigramJaccard(a.orig.front, a.cur.front))) bigChange = true;
      }
      if (dirtyB && b) {
        if (!(await saveOne(b))) throw new Error("保存卡 B 失败");
        saved.push("B");
        if (isBigFrontChange(bigramJaccard(b.orig.front, b.cur.front))) bigChange = true;
      }
      changedRef.current = true;
      if (!mounted.current) return;
      if (saved.includes("A")) setA((s) => ({ ...s, orig: s.cur }));
      if (saved.includes("B")) setB((s) => (s ? { ...s, orig: s.cur } : s));
      setAdopted(new Set());
      // 此次尚无链接才补写 manual（已诊断过的会话已有链接，不再新增）
      if (!linkIdRef.current) await writeLink("manual", "");
      eventBus.emit("cards/changed");
      setNotice(`已保存卡 ${saved.join("、")} 的修改。${bigChange ? "改动较大，如需按新卡重新学习，可在卡片浏览中手动重置。" : ""}`);
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  // ---- AI 诊断（点击才调用） ----
  async function diagnose() {
    if (diagnosing || !aiUsable) return;
    setDiagnosing(true);
    setError("");
    setNotice("");
    setResult(null);
    setContrast(EMPTY_CONTRAST);
    try {
      // 提示词只放模板库，缺失即报错（不在代码里放兜底提示词）
      const tpl = await window.promptsAPI?.get("card-disambiguate");
      if (!tpl?.content) throw new Error("提示词模板缺失（card-disambiguate）：请到 设置 → 提示词 检查模板是否被删除。");
      const snap = { A: a.cur, B: hasB && b ? b.cur : null };
      const input = buildDisambiguateInput({ a: sideInput(a, originA), b: hasB && b ? sideInput(b, originB) : null });
      const raw = await aiGateway.chat(
        [
          { role: "system", content: tpl.content },
          { role: "user", content: input }
        ],
        undefined,
        0.2
      );
      if (!mounted.current) return;
      const res = validateDisambiguateOutput(raw, {
        hasB,
        originA: originA ?? null,
        originB: hasB ? originB ?? null : null,
        current: { A: snap.A, B: snap.B }
      });
      setSnapshot(snap);
      setAdopted(new Set());
      setResult(res);
      void writeLink(res.verdict, res.explanation);
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mounted.current) setDiagnosing(false);
    }
  }

  function adopt(fix: DisambiguateFix) {
    patchSide(fix.card, { [fix.field]: fix.after } as Partial<EditableFields>);
    setAdopted((prev) => new Set([...prev, fixKey(fix)]));
    setNotice("");
  }

  async function archive(side: Side) {
    const target = side === "A" ? a : b;
    if (!target) return;
    setArchiveBusy(true);
    setError("");
    try {
      const r = await cardsApi.batch("archive", [target.card.id]);
      if (!r?.ok) throw new Error(r?.reason || "归档失败");
      archivedIdsRef.current.push(target.card.id);
      changedRef.current = true;
      if (!mounted.current) return;
      setArchivedSides((prev) => new Set([...prev, side]));
      eventBus.emit("cards/changed");
      setNotice(`已归档卡 ${side}（不再复习，可在卡片浏览中恢复）。`);
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mounted.current) setArchiveBusy(false);
    }
  }

  async function generateContrast() {
    if (!b || contrast.running) return;
    setContrast({ ...EMPTY_CONTRAST, running: true });
    const side = (s: SideData) => {
      const src = sourceOf(s.card);
      const q = s.cur.contextPrefix ? `${s.cur.contextPrefix}${s.cur.front}` : s.cur.front;
      return { front: q, back: s.cur.back, title: src.title, author: src.author, anchor: src.anchor };
    };
    try {
      const { drafts } = await generateContrastDrafts(
        { a: side(a), b: side(b) },
        (n) => { if (mounted.current) setContrast((c) => ({ ...c, progress: n })); },
        () => { if (mounted.current) setContrast((c) => ({ ...c, thinking: true })); }
      );
      if (mounted.current) setContrast({ ...EMPTY_CONTRAST, drafts });
    } catch (err) {
      if (mounted.current) setContrast({ ...EMPTY_CONTRAST, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const srcA = sourceOf(a.card);
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        e.stopPropagation();
        close();
      }}
    >
      <div
        className="modal-panel disamb-modal"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="卡片辨析"
        data-testid="disamb-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>{step === "pick" ? "辨析 · 选择另一张卡" : single ? "辨析 · 单卡" : "辨析 · 对照两张卡"}</h2>
          <button className="icon-btn modal-close" title="关闭" onClick={close}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div className="modal-scroll">
          {step === "pick" && (
            <CandidatePicker selfId={card.id} all={all} ranked={ranked} loading={loadingAll} onPick={pick} onSingle={pickSingle} />
          )}

          {step === "compare" && (
            <>
              <div className="disamb-columns">
                <CardPane
                  side="A"
                  card={a.card}
                  fields={a.cur}
                  changed={dirtyA}
                  adopted={new Set([...adopted].filter((k) => k.startsWith("A:")).map((k) => k.slice(2) as keyof EditableFields))}
                  archived={archivedSides.has("A")}
                  origin={originA}
                  onChange={(p) => patchSide("A", p)}
                />
                {b && !single ? (
                  <CardPane
                    side="B"
                    card={b.card}
                    fields={b.cur}
                    changed={dirtyB}
                    adopted={new Set([...adopted].filter((k) => k.startsWith("B:")).map((k) => k.slice(2) as keyof EditableFields))}
                    archived={archivedSides.has("B")}
                    origin={originB}
                    onChange={(p) => patchSide("B", p)}
                  />
                ) : (
                  <section className="disamb-pane disamb-pane-single" aria-label="单卡模式">
                    <h3 className="disamb-pane-title">单卡模式</h3>
                    <p className="form-hint">没有对照卡：只诊断卡 A（{srcA.title ? `《${srcA.title}》` : "来源未知"}）本身是否问得不清、缺少限定。</p>
                  </section>
                )}
              </div>

              {error && <p className="ai-draft-warnings"><IconAlert size={14} /> {error}</p>}
              {notice && <p className="form-hint state-ok" role="status">{notice}</p>}
              {aiUsable === false && <p className="form-hint">{NO_KEY_HINT}</p>}
              {diagnosing && <p className="form-hint">AI 正在诊断…</p>}

              {result && snapshot && (
                <DiagnosisPanel
                  result={result}
                  snapshot={snapshot}
                  single={single}
                  adopted={adopted}
                  archivedSides={archivedSides}
                  archiveBusy={archiveBusy}
                  contrast={contrast}
                  contrastSource={{ title: srcA.title, author: srcA.author, contextRef: a.card.contextRef }}
                  onAdopt={adopt}
                  onArchive={archive}
                  onGenerateContrast={() => void generateContrast()}
                />
              )}

            </>
          )}

          <Footer
            step={step}
            origin={origin}
            dirty={dirty}
            saving={saving}
            aiUsable={aiUsable}
            diagnosing={diagnosing}
            skipAfter={skipAfter}
            onSkipAfter={setSkipAfter}
            onBack={backToPick}
            onSave={() => void save()}
            onDiagnose={() => void diagnose()}
            onClose={close}
          />
        </div>
      </div>
    </div>
  );
}
