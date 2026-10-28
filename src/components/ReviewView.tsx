// 连续刷题复习界面（v11.1 连续模式；v12.2 去页内重复标题 + 跳转原文 + 删除按钮）：
// 进入即开始；评分后自动展示下一张到期卡。每张卡都重新拉取今日队列取队首，
// 口径 = 今日队列视图（v34/M12 §4.2-20：FSRS due 升序 + 同 due 优先级降序 + 同源卡延后），学习中新到期卡实时进入队列。
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { fsrsEngine, type Rating } from "../lib/fsrs";
import { cardsApi, hasSourceAnchor, type CardRecord, type TodayQueue } from "../lib/cards";
import { playVocabAudio } from "../lib/dictClient";
import { settingsStore } from "../lib/settings";
import { eventBus } from "../lib/eventbus";
import { useCommandActions } from "../lib/useCommands";
import { bindingHint } from "../lib/commands";
import { fetchCardCounts, type CardCounts } from "../lib/sessionQueue";
import { attachRipple, settle } from "../lib/press"; // D88 §4.2/§4.3：主 CTA settle + 填充钮涟漪
import { CardFace } from "./CardBrowser";
import { fetchSessionQueue, type SessionItem } from "../lib/sessionQueue";
import ExtractCardFace, { ExtractActionsBar } from "./ExtractCardFace";
import { readingWorkflow, undoApi, type DueTopic, type UndoInfo, type UndoLastResult } from "../lib/readingWorkflow";
import { isImeComposing } from "../lib/ime";
import { isInModal, isNativeControlKey, isTextEntryTarget } from "../lib/keyTarget";
import DisambiguateModal, { type DisambiguateCloseResult } from "./DisambiguateModal";
import { cardLinksApi, type CardLink } from "../lib/cardLinks";
import { VERDICT_LABELS } from "../lib/disambiguateCore.mjs";
import { disambHintText, latestLink } from "../lib/disambiguateUi";
import ImageLightbox from "./ImageLightbox";
import AnswerJudgeModal from "./AnswerJudgeModal";
// v48.61（D104）：背面辅助字段区（助记/例子/来源，app.cardFaceExtras 三开关）——与卡详情预览同一组件
import CardFaceExtrasBlock from "./CardFaceExtras";
// v48.60（D101/D102）：答案揭示后快捷打标 + 「不再关心」归档
import TagInput from "./TagInput";
import { applyTagDelta, type TagVocabEntry } from "../lib/tags";
// v48.63（D107）：标签功能总开关——复习页标签区与快捷打标入口受其控制
import { useTagsEnabled } from "../lib/tagSettings";
// v48.85（D129，B2/B3）：成长反馈——评分成功边界后拉取微反馈 + 收尾页会话成果汇总（只读，零写路径）
import { growthApi, readGrowthFeedbackEnabled, type GrowthEventHit, type GrowthFoldEntry, type GrowthSessionSummaryResult } from "../lib/growth";
import { growthEventText, growthEvidenceLines, growthFoldText, growthTierLabel } from "../lib/growthStrings";
import GrowthToast from "./GrowthToast";
import { useT } from "../lib/i18n";
// D248（T8）：复习会话/呈现/揭示埋点（评分本身由主进程 tap 记）
import { track, newUuid7, getTrackConfig, setTrackContext } from "../lib/behavior/track";
import { createAttention } from "../lib/behavior/attention";

// A-1（审计）：渲染期调用不得抛。原写法 `previews?.items ?? fsrsEngine.preview(current!.fsrs)`
// 在 previews 为 null 时会同步抛，被根错误边界接管 → 整应用停止渲染。这里降级为空列表。
function safePreviewItems(fsrs: unknown): ReturnType<typeof fsrsEngine.preview> {
  try { return fsrsEngine.preview(fsrs as never); } catch { return []; }
}

// ---------- v48.85（D129，B3 / 设计稿 §5.2）：会话成果汇总（本轮成果） ----------
// 收尾页挂载时经 growthAPI.sessionSummary(sessionStartTs) 拉取一次；空命中零渲染（禁「今日无成长」
// 类负面对照，§6.6.3）；行序 = §6.6.1 表序（主进程 foldSameDay/compareHits 已排好，禁第二套排序）；
// hits 画可见行、folded 画折叠行（勿重复）；行内「证据」展开与折叠行展开均走 §7 折叠模式（.collapse-clip）。

function GrowthRow({ hit }: { hit: GrowthEventHit }) {
  const [open, setOpen] = useState(false);
  const lines = growthEvidenceLines(hit);
  return (
    <li className="growth-row" data-growth-row data-growth-event={hit.type} data-growth-tier={hit.tier}>
      <span className="growth-row-tier mono">{growthTierLabel(hit.tier)}</span>
      <span className="growth-row-text">{growthEventText(hit)}</span>
      {lines.length > 0 && (
        <button type="button" className="growth-toast-more" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          证据
        </button>
      )}
      <div className={`collapse-clip${open ? " is-open" : ""}`}>
        <div className="collapse-inner">
          <div className="growth-toast-detail">
            {lines.map((l, i) => (
              <p key={i} className="mono">{l}</p>
            ))}
          </div>
        </div>
      </div>
    </li>
  );
}

function GrowthFoldRow({ fold }: { fold: GrowthFoldEntry }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="growth-row" data-growth-fold>
      <button type="button" className="growth-fold-btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {growthFoldText(fold.count)}
      </button>
      <div className={`collapse-clip${open ? " is-open" : ""}`} data-growth-fold-list>
        <div className="collapse-inner">
          {/* 折叠明细：每条同 growth-row 结构（设计稿 §5.2） */}
          <ul className="growth-fold-list">
            {fold.hits.map((h) => (
              <GrowthRow key={h.key} hit={h} />
            ))}
          </ul>
        </div>
      </div>
    </li>
  );
}

function GrowthSessionSummary({ fromTs }: { fromTs: number }) {
  const T = useT();
  const [result, setResult] = useState<GrowthSessionSummaryResult | null>(null);
  useEffect(() => {
    let alive = true;
    growthApi
      .sessionSummary(fromTs)
      .then((r) => { if (alive) setResult(r); })
      .catch(() => { /* 汇总是增强信息：取不到就不显示（§4.17-3 派生失败静默） */ });
    return () => { alive = false; };
  }, [fromTs]);
  if (!result || !result.enabled) return null; // 设置关闭 / 主进程降级 → 静默零渲染
  const hits = result.hits ?? [];
  const folded = result.folded ?? [];
  if (hits.length === 0 && folded.length === 0) return null; // 空态：不渲染本块（G-8）
  return (
    <div className="growth-session" data-growth-session>
      <p className="growth-session-title">{T("本轮成果")}</p>
      <ul className="growth-session-list">
        {hits.map((h) => (
          <GrowthRow key={h.key} hit={h} />
        ))}
        {folded.map((f, i) => (
          <GrowthFoldRow key={`${f.type}:${f.dayStart}:${i}`} fold={f} />
        ))}
      </ul>
    </div>
  );
}

// D88 §7.4：评分钮档名（预览 review.html 口径：重来/困难/良好/简单；色点承载语义色）。
// 快捷键 title 气泡沿用 D77 口径（kbd 角标不采纳）：`重来（快捷键：1）· 间隔 10分` 式组装。
const RATING_LABEL: Record<Rating, string> = { Again: "重来", Hard: "困难", Good: "良好", Easy: "简单" };

export default function ReviewView({
  onJumpToDoc,
  bookItemIds,
  scopeLimits,
  scopeTags,
  scopeKpIds,
  onMaterialName
}: {
  onJumpToDoc?: (docId: string, anchor: { anchorText: string; anchorRatio?: number; cfi?: string; chapterIndex?: number; pageIndex?: number; imageAnchor?: { alt?: string; contextText?: string }; occlusion?: { rects: { x: number; y: number; w: number; h: number; ord: number }[]; shapes?: unknown; regionScope?: string; cardOrd?: number; assetPath?: string } }) => void;
  /** v48.22（D58 §6.8-8）：本书范围内的集中复习（阅读器「复习闪卡」入口） */
  bookItemIds?: string[];
  /** 筛选牌组的上限覆写（§6.8-5：只收紧，不另开预算） */
  scopeLimits?: Record<string, number> | null;
  /** v48.61（D105）：筛选牌组的标签/知识点条件（进 applyScope 过滤） */
  scopeTags?: string[];
  scopeKpIds?: string[];
  /** v48.41（D81）：当前卡材料名上报（顶栏中间显示；无材料名时回调空串＝回落「复习」字样） */
  onMaterialName?: (name: string) => void;
} = {}) {
  const T = useT();
  const tagsEnabled = useTagsEnabled();
  // D248（T8）：一次复习会话的 BDI 上下文（ctxId 每挂载一次；注意力 review 阈值 90s）
  const bdiCtxIdRef = useRef<string>(newUuid7());
  const bdiAttentionRef = useRef<ReturnType<typeof createAttention> | null>(null);
  const bdiPresentationRef = useRef<{ id: string; at: number; revealed: boolean } | null>(null);
  const bdiPresentedCardRef = useRef<string | null>(null);
  const bdiDoneRef = useRef(0);
  const bdiStartMonoRef = useRef(performance.now());
  useEffect(() => {
    const attn = createAttention({ cutoffHour: getTrackConfig().cutoffHour });
    bdiAttentionRef.current = attn;
    attn.start();
    attn.setContext({ surface: "review", entityType: "card", ctxId: bdiCtxIdRef.current, origin: "review_flow" });
    setTrackContext({ surface: "review", ctxId: bdiCtxIdRef.current });
    track("review.session", { ctxId: bdiCtxIdRef.current, origin: "review_flow", props: { phase: "start", mode: "due", planned: 0, done: 0, dur_ms: 0 } });
    return () => {
      attn.stop("unload");
      bdiAttentionRef.current = null;
      track("review.session", {
        ctxId: bdiCtxIdRef.current,
        origin: "review_flow",
        props: { phase: "end", mode: "due", planned: 0, done: bdiDoneRef.current, dur_ms: Math.round(performance.now() - bdiStartMonoRef.current) },
      });
      setTrackContext(null);
    };
  }, []);
  const [current, setCurrent] = useState<(CardRecord & { docTitle?: string }) | null>(null);
  const [showBack, setShowBack] = useState(false);
  // v48.41（D81）：当前卡材料名上报顶栏（替代「复习」字样；无材料名＝空串，顶栏回落原字样）
  const materialName = String(current?.sourceRef?.title ?? "");
  const onMaterialNameRef = useRef(onMaterialName);
  onMaterialNameRef.current = onMaterialName;
  useEffect(() => {
    onMaterialNameRef.current?.(materialName);
  }, [materialName]);
  /** 顶栏三档计数（今日可用口径；每次换卡/评完刷新） */
  const [counts, setCounts] = useState<CardCounts>({ new: 0, learning: 0, review: 0 });
  // D88 §7.2：计数 bump——由真实 counts 变化驱动（React 比较前后值加类、200ms 后摘），禁假动画
  const prevCountsRef = useRef<CardCounts>(counts);
  const [bumpKeys, setBumpKeys] = useState<{ new: boolean; learning: boolean; review: boolean }>({
    new: false,
    learning: false,
    review: false
  });
  useEffect(() => {
    const prev = prevCountsRef.current;
    prevCountsRef.current = counts;
    const changed = (["new", "learning", "review"] as const).filter((k) => counts[k] !== prev[k]);
    if (changed.length === 0) return;
    setBumpKeys({
      new: changed.includes("new"),
      learning: changed.includes("learning"),
      review: changed.includes("review")
    });
    const t = window.setTimeout(() => setBumpKeys({ new: false, learning: false, review: false }), 200);
    return () => window.clearTimeout(t);
  }, [counts]);
  /** 底栏「更多」弹层（向上弹；点外部/Esc 收起） */
  const [barMoreOpen, setBarMoreOpen] = useState(false);
  const barMoreRef = useRef<HTMLSpanElement | null>(null);
  // D88 §4.3：涟漪挂载面＝填充钮白名单（.bar-btn.primary「显示答案」/ .grade.recommended「良好」）。
  // 两钮随 showBack 互斥换挂 ⇒ 以 showBack 为依赖重新绑定（挂载帧之后执行，refs 已就位）。
  const revealBtnRef = useRef<HTMLButtonElement | null>(null);
  const goodBtnRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const el = showBack ? goodBtnRef.current : revealBtnRef.current;
    if (!el) return;
    return attachRipple(el);
  }, [showBack]);
  // v49.0 / D174：ui/review-flip（皮肤 API，纯表现层——翻面即发）
  useEffect(() => {
    if (showBack) eventBus.emit("ui/review-flip", {});
  }, [showBack]);
  // D248（T8）：每张卡一次 review.shown（StrictMode 双跑不重复）；揭示时补 review.revealed（单调时钟 think_ms）
  useEffect(() => {
    if (!current) {
      bdiPresentedCardRef.current = null;
      bdiPresentationRef.current = null;
      return;
    }
    if (bdiPresentedCardRef.current === current.id) return;
    bdiPresentedCardRef.current = current.id;
    const id = newUuid7();
    bdiPresentationRef.current = { id, at: performance.now(), revealed: false };
    track("review.shown", {
      cardId: current.id,
      ctxId: bdiCtxIdRef.current,
      presentationId: id,
      origin: "review_flow",
      surface: "review",
      props: { cardType: current.cardType, queue: "due", position: bdiDoneRef.current, isNew: String(current.fsrs?.state) === "new" },
    });
  }, [current]);
  useEffect(() => {
    if (!showBack || !current) return;
    const p = bdiPresentationRef.current;
    if (!p || p.revealed) return;
    p.revealed = true;
    track("review.revealed", {
      cardId: current.id,
      ctxId: bdiCtxIdRef.current,
      presentationId: p.id,
      origin: "review_flow",
      surface: "review",
      props: { dur_ms: Math.max(0, Math.round(performance.now() - p.at)) },
    });
    bdiAttentionRef.current?.noteInput("key");
  }, [showBack, current]);
  /** 显示答案的**生效**快捷键（随设置变化；不许把「空格」写死） */
  const hint = bindingHint("review.showAnswer");
  const [startedAt, setStartedAt] = useState(Date.now());
  const [loading, setLoading] = useState(true);
  const [doneCount, setDoneCount] = useState(0);
  const [sessionDone, setSessionDone] = useState(false);
  // v49.0 / D174：ui/session-complete（皮肤 API——复习会话收口单点）
  useEffect(() => {
    if (sessionDone) eventBus.emit("ui/session-complete", { kind: "review" });
  }, [sessionDone]);
  // D88 §7.2：进度轨真实分母（分母 0 ⇒ 整个进度轨不渲染，禁假动画）
  const progressDenominator = doneCount + counts.new + counts.learning + counts.review;
  const progressPct =
    progressDenominator > 0 ? Math.round((doneCount / progressDenominator) * 10000) / 100 : 0;
  // v23（§4.4.9）：persist 失败态——停留当前卡、封锁评分/跳过/删除，提供「重试保存」
  const [saveError, setSaveError] = useState(false);
  // v23（§4.4.3）：预览携带源卡状态引用，评分提交时判废（防复用过期预览）
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [previews, setPreviews] = useState<{
    sourceCardId: string;
    sourceFsrs: CardRecord["fsrs"];
    items: ReturnType<typeof fsrsEngine.preview>;
  } | null>(null);
  // M4 快捷键防连发：动作进行中（评分/暂停/跳过/删除落库+取下一张）when() 一律拒绝新的按键触发
  const actionBusyRef = useRef(false);
  // v22 撤销评分：最近一条可撤销评分（有评分前快照且卡未删），null=当前不可撤销
  const [undoInfo, setUndoInfo] = useState<{ logId: string; cardId: string; rating: string; reviewedAt: number } | null>(null);
  // v48.77（D121 §3.1）：辨析弹窗（替换 v30 易混对比卡确认框）；presetOther=「已辨析」提示点击时直达第二屏的对端卡
  const [disamb, setDisamb] = useState<{ presetOther?: string } | null>(null);
  // D121 §3.5：当前卡的辨析链接（换卡 / 弹窗关闭后刷新；失败静默）
  const [cardLinks, setCardLinks] = useState<CardLink[]>([]);
  const [linksTick, setLinksTick] = useState(0);
  // v48.58（D99）：AI 判答模态（自答交给 AI 与标准答案等价比对；零写库，见 AnswerJudgeModal）
  const [judgeOpen, setJudgeOpen] = useState(false);
  // v48.60（D101）：答案揭示后的快捷打标（meta 行「＋标签」；仅背面出现，正面永不显示标签——防泄题）
  const [tagOpen, setTagOpen] = useState(false);
  const [tagDraft, setTagDraft] = useState<string[]>([]);
  const [tagVocab, setTagVocab] = useState<TagVocabEntry[]>([]);
  // 换卡即关（防键盘快捷键换卡后模态显示旧卡）
  useEffect(() => {
    setJudgeOpen(false);
    setTagOpen(false);
    setTagDraft([]);
    setDisamb(null);
  }, [current?.id]);
  // D121 §3.5：拉取当前卡的辨析链接（只读；失败静默）
  useEffect(() => {
    const id = current?.id;
    setCardLinks([]);
    if (!id) return;
    let cancelled = false;
    cardLinksApi
      .listForCard(id)
      .then((l) => { if (!cancelled) setCardLinks(l); })
      .catch(() => { /* 提示是增强信息：取不到就不显示 */ });
    return () => {
      cancelled = true;
    };
  }, [current?.id, linksTick]);
  // v48.60（D101）：快捷打标词表（编辑器打开时拉取；派生只读）
  useEffect(() => {
    if (!tagOpen) return;
    let cancelled = false;
    window.cardsAPI?.listTags?.().then((l) => {
      if (!cancelled) setTagVocab(l ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [tagOpen]);
  // v34（M12，§4.16）：今日同源暂缓清单——延后不写 FSRS，此处给出可读原因（与队列同一视图口径）
  const [deferred, setDeferred] = useState<TodayQueue["deferred"]>([]);
  const [deferredOpen, setDeferredOpen] = useState(false);

  // ---------- v48.85（D129，B2/B3）：成长反馈 ----------
  // 设置读侧（§5.1 零渲染零计算短路）：enabled=false 时评分路径**完全不调用** growth:afterReview
  // （读取路径短路，非「调了但藏 UI」）。挂载时现读 + settings/changed（growthFeedback）时重读。
  const growthEnabledRef = useRef(true);
  useEffect(() => {
    let alive = true;
    const read = () => {
      void readGrowthFeedbackEnabled().then((on) => {
        if (alive) growthEnabledRef.current = on;
      });
    };
    read();
    const off = eventBus.on("settings/changed", (payload?: unknown) => {
      const key = (payload as { scope?: string; key?: string } | undefined)?.key;
      if (!key || key === "growthFeedback") read();
    });
    return () => {
      alive = false;
      off();
    };
  }, []);
  // 微反馈条状态：单槽（至多一条，新命中直接覆盖 §6.6.2）；n = 同键事件重挂序号（撤销后重评同键
  // 再触发时强制 GrowthToast 重挂、重起 5s 计时）。设置关闭或 afterReview 失败 → 恒 null（零渲染）。
  const [growthToast, setGrowthToast] = useState<{ hit: GrowthEventHit; n: number } | null>(null);
  const growthToastSeqRef = useRef(0);
  // 会话起点（§5.2：sessionStartTs = 会话首卡渲染时刻，组件 state 记录；会话成果汇总窗口起点）
  const [sessionStartTs, setSessionStartTs] = useState(() => Date.now());

  // v49.61 / D232：复习方式＝混合复习（SuperMemo 式，app.extracts.mergeIntoReview=true）——会话里摘录与
  // 闪卡穿插推送；撤销走与摘录页同一条统一撤销链（undo:last：最近一次评分或摘录操作，线性回退）。
  // 取值以会话队列回带的 mergeIntoReview 为准（主进程装配口径，唯一事实源）。
  const [mixed, setMixed] = useState(false);
  const mixedRef = useRef(false);
  const [mixedUndo, setMixedUndo] = useState<UndoInfo | null>(null);

  // 查询最近可撤销评分（评分/撤销后刷新；挂起/跳过/删除不产生日志无需刷新，删除他人卡由撤销时服务端兜底）
  const refreshUndo = useCallback(async () => {
    const [info, last] = await Promise.all([
      mixedRef.current ? undoApi.info().catch(() => null) : Promise.resolve(null),
      cardsApi.lastUndoableReview()
    ]);
    setMixedUndo(info && info.available ? info : null);
    setUndoInfo(last ?? null);
  }, []);

  useEffect(() => {
    void refreshUndo();
  }, [refreshUndo, mixed]);

  // v32（M7）自动发音；v48.58（D99）改判：跟随**发音按钮的出现面**——听音卡（按钮嵌题面）出卡即读，
  // 其余单词卡（按钮嵌答案区）翻面即读；同卡同面只触发一次（翻回再翻到可再触发一次）。
  // dictAutoSpeak 默认值随 D99 改为开（§7.4 v32 追记六「默认关」作废；显式存过 false 的库不受影响）
  const autoSpokenRef = useRef<string>("");
  useEffect(() => {
    const dj = current?.dictJson;
    if (!dj) return;
    const isListening = dj.kind ? dj.kind === "listening" : String(current?.frontMarkdown ?? "").startsWith("发音：");
    const face = isListening ? "front" : showBack ? "back" : null;
    if (!face) return;
    const key = `${current!.id}:${face}`;
    if (autoSpokenRef.current === key) return;
    autoSpokenRef.current = key;
    void settingsStore.get<boolean>("app", "dictAutoSpeak", true).then((on) => {
      if (on && current?.dictJson) void playVocabAudio(current.dictJson);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, showBack]);

  // 拉取今日队列队首（同一视图：到期 + 同源延后 + 规范序），并同步「同源暂缓」清单。
  // v48.22（D58 §6.8-3）：改为消费**会话队列**（§4.2-26 唯一装配面）——它同样受每日上限与
  // 按书范围约束；混编出的摘录条目由「摘录」页处理，本页只取其中的卡片（摘录不会因此丢失：
  // 未处理即仍 due，摘录页照常可见）。
  // v48.22（D58 §6.8-3）：合并会话里推送到的摘录——与摘录页共用同一张卡面就地处理
  const [currentExtract, setCurrentExtract] = useState<DueTopic | null>(null);
  const extractHeadRef = useRef<DueTopic | null>(null);

  const sessionScope = () =>
    bookItemIds?.length || (scopeLimits && Object.keys(scopeLimits).length) || scopeTags?.length || scopeKpIds?.length
      ? { bookItemIds: bookItemIds ?? undefined, tags: scopeTags, kpIds: scopeKpIds, limits: scopeLimits ?? undefined }
      : undefined;
  const nextCard = useCallback(async (): Promise<(CardRecord & { docTitle?: string }) | null> => {
    const session = await fetchSessionQueue({ scope: sessionScope() });
    if (session) {
      mixedRef.current = session.mergeIntoReview === true;
      setMixed(mixedRef.current);
      setDeferred((session.deferred ?? []) as unknown as TodayQueue["deferred"]);
      const head = session.items[0];
      // 队首是摘录 → 交给摘录卡面（本页不跳过它：跳过会让合并模式名存实亡）
      if (head && head.kind === "extract" && head.extract) {
        extractHeadRef.current = head.extract;
        setCurrentExtract(head.extract);
        return null;
      }
      extractHeadRef.current = null;
      setCurrentExtract(null);
      const firstCard = session.items.find((it: SessionItem) => it.kind === "card");
      return (firstCard?.card as (CardRecord & { docTitle?: string })) ?? null;
    }
    const q = await cardsApi.todayQueue();
    setDeferred(q.deferred ?? []);
    return q.cards[0] ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookItemIds, scopeLimits]);

  // 开场拉第一张；若 sessionStorage 有跳转前的复习现场（从阅读器返回）则恢复该卡
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let resumeCard: (CardRecord & { docTitle?: string }) | null = null;
      let resumeShowBack = false;
      try {
        const saved = sessionStorage.getItem("reviewSession");
        if (saved) {
          sessionStorage.removeItem("reviewSession");
          const parsed = JSON.parse(saved) as { cardId?: string; showBack?: boolean };
          if (parsed.cardId) {
            const got = await cardsApi.get(parsed.cardId);
            if (got) {
              resumeCard = got;
              resumeShowBack = Boolean(parsed.showBack);
            }
          }
        }
      } catch { /* 无现场则正常开新轮 */ }
      if (cancelled) return;
      if (resumeCard) {
        setCurrent(resumeCard);
        setShowBack(resumeShowBack);
        setStartedAt(Date.now());
        setSessionStartTs(Date.now()); // v48.85（D129 B3）：会话首卡渲染时刻
        setLoading(false);
        return;
      }
      const c = await nextCard();
      if (cancelled) return;
      if (c) {
        setCurrent(c);
        setShowBack(false);
        setStartedAt(Date.now());
        setSessionStartTs(Date.now()); // v48.85（D129 B3）：会话首卡渲染时刻
      } else {
        setSessionDone(true);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [nextCard]);

  // A-1（审计）：preview 在 React 生命周期里抛错会被**根**错误边界接管 → 整应用停止渲染。
  // 这里把爆炸半径收回一张卡：失败即置错误态、不渲染四档按钮、并在页内说明原因。
  const [previewError, setPreviewError] = useState<string | null>(null);
  // 当前卡四档预览（§4.4.3 同源：评分复用，预览=落库）
  useEffect(() => {
    try {
      setPreviews(
        current
          ? { sourceCardId: current.id, sourceFsrs: current.fsrs, items: fsrsEngine.preview(current.fsrs) }
          : null
      );
      setPreviewError(null);
    } catch (e) {
      setPreviews(null);
      setPreviewError(e instanceof Error ? e.message : String(e));
    }
  }, [current]);

  // 内联编辑落库（§8.2.7 渐进措辞优化）：只改文案，不动 FSRS 状态（updateCard 保留 fsrs 字段）
  async function handleEdit(patch: { frontMarkdown?: string; backMarkdown?: string; noteText?: string }) {
    if (!current) return;
    const next = { ...current, ...patch };
    setCurrent(next);
    await cardsApi.update({
      ...next,
      frontMarkdown: patch.frontMarkdown ?? current.frontMarkdown,
      backMarkdown: patch.backMarkdown ?? current.backMarkdown
    });
    eventBus.emit("cards/changed");
  }

  async function grade(rating: Rating) {
    if (!current || actionBusyRef.current || saveError || previewError) return;
    bdiAttentionRef.current?.noteInput("pointer");
    actionBusyRef.current = true;
    try {
      // 过期判废（§4.4.3 v23）：源卡状态与预览生成时不一致 → 现场重算，绝不复用过期预览
      const bundle = previews && previews.sourceCardId === current.id && previews.sourceFsrs === current.fsrs ? previews : null;
      const previewItem = bundle?.items.find((p) => p.rating === rating);
      const fsrsState = previewItem?.fsrsState ?? fsrsEngine.next(current.fsrs, rating).fsrsState;
      const lapses = fsrsState.lapses ?? 0;
      // v22：第 5 参传评分前快照，该次评分才可撤销（§4.4.4）
      // v23（§4.4.9）：persist 失败 → 停留当前卡、封锁动作、提供重试保存（review 成功边界=COMMIT+persist+IPC）
      try {
        await cardsApi.review(current.id, fsrsState, rating, Date.now() - startedAt, current.fsrs);
      } catch {
        setSaveError(true);
        return;
      }
      // v49.0 / D174：ui/review-grade（皮肤 API，评分成功边界后）
      eventBus.emit("ui/review-grade", { grade: rating });
      bdiDoneRef.current += 1; // D248：会话完成数（review.session 收尾与 shown.position 用）
      // v48.85（D129 B2，§4.17-6⑥/§6.6.2 非阻塞硬性）：评分成功边界（COMMIT + persist + IPC 成功）后的
      // 成长反馈拉取——fire-and-forget：不 await、不进 actionBusy、失败静默（growthApi 内部已兜底降级），
      // 绝不阻塞评分→下一张卡路径；设置关闭（growthEnabledRef=false）时完全不调用（读取路径短路）。
      // toast 候选至多 1 条由主进程 pickTopEvent 选出（口径唯一居所 electron/growth.js）；单槽直接覆盖。
      if (growthEnabledRef.current) {
        const gradedCardId = current.id;
        void growthApi.afterReview(gradedCardId).then((r) => {
          if (r.enabled && r.toast) {
            growthToastSeqRef.current += 1;
            setGrowthToast({ hit: r.toast, n: growthToastSeqRef.current });
          }
        });
      }
      // Leech 检测（§8.7 + §11.4 字段级更新）
      if (fsrsEngine.isLeech(lapses, 8) && !(current.leech?.isLeech)) {
        try {
          await cardsApi.addIssue({
            cardId: current.id,
            ruleId: "LEECH",
            severity: "warn",
            message: T("连续遗忘 {n} 次，已自动暂停", { n: lapses }),
            source: "lint"
          });
          await cardsApi.updateLeech(current.id, { isLeech: true, suspended: true, suspendedAt: Date.now() });
        } catch {
          setSaveError(true);
          return;
        }
        eventBus.emit("leech/detected", current.id);
      }
      eventBus.emit("cards/changed");
      setDoneCount((n) => n + 1);
      // 连续模式：直接取下一张（评分后该卡 due 已在未来，不会重复出现）
      const next = await nextCard();
      if (next) {
        setCurrent(next);
        setShowBack(false);
        setStartedAt(Date.now());
      } else {
        setCurrent(null);
        setSessionDone(true);
      }
      void refreshUndo();
    } finally {
      actionBusyRef.current = false;
    }
  }

  async function markAndSuspend() {
    if (!current || actionBusyRef.current || saveError) return;
    actionBusyRef.current = true;
    try {
      try {
        await cardsApi.addIssue({
          cardId: current.id,
          ruleId: "MARK",
          severity: "warn",
          message: T("复习中标记待改"),
          source: "review-mark"
        });
        await cardsApi.setSuspended(current.id, true, "review-mark");
      } catch {
        setSaveError(true);
        return;
      }
      eventBus.emit("cards/changed");
      setDoneCount((n) => n + 1);
      const next = await nextCard();
      if (next) {
        setCurrent(next);
        setShowBack(false);
        setStartedAt(Date.now());
      } else {
        setCurrent(null);
        setSessionDone(true);
      }
      void refreshUndo();
    } finally {
      actionBusyRef.current = false;
    }
  }

  // v48.60（D102）：「不再关心」＝归档当前卡并进下一张——不评分、不写 review_logs、不计四类上限；
  // FSRS 零写入（fsrs_json 原样，恢复后按原 due 继续；浏览器「已归档」可恢复）
  // D121 §3.2：alreadyArchived=辨析弹窗内已归档当前卡，只推进不再重复归档
  async function archiveAndNext(alreadyArchived = false) {
    if (!current || actionBusyRef.current || saveError) return;
    actionBusyRef.current = true;
    try {
      if (!alreadyArchived) {
        try {
          const r = await cardsApi.batch("archive", [current.id]);
          if (!r?.ok) {
            setSaveError(true);
            return;
          }
        } catch {
          setSaveError(true);
          return;
        }
      }
      eventBus.emit("cards/changed");
      setDoneCount((n) => n + 1);
      const next = await nextCard();
      if (next) {
        setCurrent(next);
        setShowBack(false);
        setStartedAt(Date.now());
      } else {
        setCurrent(null);
        setSessionDone(true);
      }
      void refreshUndo();
    } finally {
      actionBusyRef.current = false;
    }
  }

  // v48.60（D101）：答案揭示后的快捷打标——单卡写入（ids 长度 1），不碰评分时序
  async function applyQuickTags() {
    if (!current || tagDraft.length === 0) return;
    const next = applyTagDelta(current.tags ?? [], tagDraft, []).tags;
    const r = await cardsApi.setTags([{ id: current.id, tags: next }]);
    if (r?.ok) {
      setCurrent({ ...current, tags: next });
      setTagDraft([]);
      setTagOpen(false);
      eventBus.emit("cards/changed");
    }
  }

  // cardOverride：辨析弹窗改过卡面文字后传入最新整行，避免全行更新用旧文案覆盖编辑
  async function skip(cardOverride?: CardRecord & { docTitle?: string }) {
    if (!current || actionBusyRef.current || saveError) return;
    actionBusyRef.current = true;
    try {
      // 跳过：不评分、不写 review_log（保持 FSRS 历史纯净），仅把 due 后移 10 分钟使其沉底
      const c = cardOverride ?? current;
      // 统计埋点：记录跳过事件（队列水位瀑布的「跳过」档数据源）
      void cardsApi.skip(c.id);
      const fsrs = { ...(c.fsrs ?? {}), due: Date.now() + 10 * 60_000 };
      try {
        await cardsApi.update({ ...c, fsrs });
      } catch {
        setSaveError(true);
        return;
      }
      const next = await nextCard();
      if (next && next.id !== c.id) {
        setCurrent(next);
        setShowBack(false);
        setStartedAt(Date.now());
      } else if (next) {
        // 队首仍是自己（只有这一张到期），留在原卡
        setShowBack(false);
        setStartedAt(Date.now());
      } else {
        setCurrent(null);
        setSessionDone(true);
      }
      void refreshUndo();
    } finally {
      actionBusyRef.current = false;
    }
  }

  // 需求3：删除当前卡（确认后软删），继续下一张
  async function handleDelete() {
    if (!current || actionBusyRef.current || saveError) return;
    if (!window.confirm(`${T("确定删除这张卡片？")}\n\n${current.frontMarkdown || current.noteText}`)) return;
    actionBusyRef.current = true;
    try {
      try {
        await cardsApi.remove(current.id);
      } catch {
        setSaveError(true);
        return;
      }
      eventBus.emit("cards/changed");
      setDoneCount((n) => n + 1);
      const next = await nextCard();
      if (next) {
        setCurrent(next);
        setShowBack(false);
        setStartedAt(Date.now());
      } else {
        setCurrent(null);
        setSessionDone(true);
      }
      void refreshUndo();
    } finally {
      actionBusyRef.current = false;
    }
  }

  // v22 撤销评分：恢复最近一次评分前状态（服务端回退 leech+移除该条日志），回到该卡背面可立即重评
  async function undoLastGrade() {
    if (actionBusyRef.current || !undoInfo || saveError) return;
    actionBusyRef.current = true;
    try {
      let r: Awaited<ReturnType<typeof cardsApi.undoReview>>;
      try {
        r = await cardsApi.undoReview();
      } catch {
        setSaveError(true);
        return;
      }
      if (r.ok && r.card) {
        setCurrent(r.card);
        setShowBack(true);
        setStartedAt(Date.now());
        setSessionDone(false);
        setDoneCount((n) => Math.max(0, n - 1));
        eventBus.emit("cards/changed");
      }
      // v34（M12）：撤销评分 → 组内当日额度自动回收（review_logs 已删），同源暂缓清单随之刷新
      setDeferred(((await cardsApi.todayQueue()).deferred) ?? []);
      setUndoInfo((await cardsApi.lastUndoableReview()) ?? null);
    } finally {
      actionBusyRef.current = false;
    }
  }

  /**
   * v49.61 / D232：混合复习的撤销——与摘录页同一条统一撤销链（undo:last，线性回退最近一次评分或摘录操作）。
   * 撤销的是评分 → 回到那张卡的背面（同 undoLastGrade）；撤销的是摘录操作 → 被召回的摘录在本会话里就把它
   * 钉为当前条（推进 / 推迟 / 毕业被撤回＝它重新到期），不在（他处的批量操作等）＝当前条不动。
   */
  async function undoMixed() {
    if (actionBusyRef.current || saveError) return;
    actionBusyRef.current = true;
    try {
      let r: UndoLastResult;
      try {
        r = await undoApi.last();
      } catch {
        setSaveError(true);
        return;
      }
      if (r.ok && r.kind === "card_grade" && r.card) {
        extractHeadRef.current = null;
        setCurrentExtract(null);
        setCurrent(r.card as CardRecord & { docTitle?: string });
        setShowBack(true);
        setStartedAt(Date.now());
        setSessionDone(false);
        setDoneCount((n) => Math.max(0, n - 1));
        eventBus.emit("cards/changed");
      } else if (r.ok && r.kind === "extract_op") {
        eventBus.emit("workflow/changed");
        const restoredId = Array.isArray(r.extractIds) && r.extractIds.length ? String(r.extractIds[0]) : null;
        const session = restoredId ? await fetchSessionQueue({ scope: sessionScope() }) : null;
        const hit = session?.items.find((it: SessionItem) => it.kind === "extract" && it.id === restoredId)?.extract ?? null;
        if (hit) {
          extractHeadRef.current = hit;
          setCurrentExtract(hit);
          setCurrent(null);
          setSessionDone(false);
        } else if (!extractHeadRef.current && !current) {
          // 收尾页上撤销了他处的操作：重新取队首（可能有条目重新到期）
          const nx = await nextCard();
          if (nx) {
            setCurrent(nx);
            setShowBack(false);
            setStartedAt(Date.now());
            setSessionDone(false);
          }
        }
      }
      setDeferred(((await cardsApi.todayQueue()).deferred) ?? []);
    } finally {
      actionBusyRef.current = false;
      void refreshUndo();
    }
  }

  // 需求2：跳转原文（保存复习现场，从阅读器返回时恢复）
  function handleJumpToSource() {
    const c = current;
    if (!c?.contextRef?.documentId || !onJumpToDoc) return;
    try {
      sessionStorage.setItem(
        "reviewSession",
        JSON.stringify({ cardId: c.id, showBack })
      );
    } catch { /* 忽略存储失败 */ }
    onJumpToDoc(c.contextRef.documentId, {
      anchorText: c.contextRef.anchorText || c.frontMarkdown || c.noteText,
      anchorRatio: c.contextRef.anchorRatio,
      cfi: c.contextRef.cfi,
      chapterIndex: c.contextRef.chapterIndex,
      pageIndex: c.contextRef.pageIndex,
      imageAnchor: c.contextRef.imageAnchor,
      // 图片卡带本卡区域，供阅读器图内高亮 / 原图对照浮层
      occlusion: c.occlusionJson ? { rects: c.occlusionJson.rects, shapes: c.occlusionJson.shapes, regionScope: c.occlusionJson.regionScope, cardOrd: c.cardOrd, assetPath: c.occlusionJson.assetPath } : undefined
    });
  }

  // D121 §3.2：辨析弹窗关闭——当前卡被归档 → 走 archiveAndNext 推进（不再 skip）；
  // 否则卡面被改过 → 重取最新行；勾选「关闭后跳过本卡」→ 既有 skip()（只记跳过事件、due+10min、不写 review_logs、不动 FSRS）
  async function handleDisambClose(res: DisambiguateCloseResult) {
    const c = current;
    setDisamb(null);
    setLinksTick((n) => n + 1);
    if (!c) return;
    if (res.archivedIds.includes(c.id)) {
      await archiveAndNext(true);
      return;
    }
    let target = c;
    if (res.changed) {
      const fresh = await cardsApi.get(c.id);
      if (fresh) {
        target = { ...fresh, docTitle: c.docTitle };
        setCurrent(target);
      }
    }
    if (res.skipRequested) await skip(target);
  }

  // 顶栏计数：换卡/评完/跳过/删除/撤销后各刷一次（只读、同队列口径）
  useEffect(() => {
    let alive = true;
    void fetchCardCounts()
      .then((c) => {
        if (alive) setCounts(c);
      })
      .catch(() => {
        /* 计数是增强信息：取不到就保持上一次的值，不打断复习 */
      });
    return () => {
      alive = false;
    };
  }, [current?.id, doneCount]);

  // 「更多」弹层：点弹层外 / Esc 收起（同刻只开这一个）
  useEffect(() => {
    if (!barMoreOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (t && barMoreRef.current?.contains(t)) return;
      setBarMoreOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setBarMoreOpen(false);
    };
    document.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [barMoreOpen]);

  // ---------- M4 复习快捷键（§9.1 M4）：空格翻面 / 1-4 评分 / z 撤销评分 / q 标记暂停 / w 跳过 / d 删除 ----------
  // 口径：翻面只对正面生效；评分只对背面（评分按钮在场时）生效；z 需存在可撤销评分；
  // q/w/d 与翻面状态无关，只要当前有卡即可触发（删除仍走 confirm 确认）。
  const hasCard = !!current;
  const canGrade = hasCard && showBack;
  // D232：撤销入口随复习方式——分开处理＝只撤卡片评分（既有）；混合复习＝统一撤销链（含摘录操作）
  const canUndo = mixed ? !!mixedUndo : !!undoInfo;
  const doUndo = () => void (mixed ? undoMixed() : undoLastGrade());
  const undoRating = mixed ? (mixedUndo?.kind === "card_grade" ? mixedUndo.rating ?? null : null) : undoInfo?.rating ?? null;
  const undoLabel =
    mixed && mixedUndo?.kind === "extract_op"
      ? T("撤销摘录操作")
      : undoRating
        ? T("撤销评分（{rating}）", { rating: undoRating })
        : T("撤销评分");
  // D99：AI 判答需要标准答案文本可比（挖空缺省态等无 backMarkdown 的卡禁用）
  const canJudge = !!current && !!(current.backMarkdown && current.backMarkdown.trim());
  useCommandActions("review", {
    "review.showAnswer": { when: () => hasCard && !showBack && !actionBusyRef.current, run: () => setShowBack(true) },
    "review.again": { when: () => canGrade && !actionBusyRef.current && !saveError, run: () => void grade("Again") },
    "review.hard": { when: () => canGrade && !actionBusyRef.current && !saveError, run: () => void grade("Hard") },
    "review.good": { when: () => canGrade && !actionBusyRef.current && !saveError, run: () => void grade("Good") },
    "review.easy": { when: () => canGrade && !actionBusyRef.current && !saveError, run: () => void grade("Easy") },
    // 混合复习：键盘撤销不等 undo:info 的异步刷新（评分后立刻按 Z 也要撤到刚才那一下）——无可撤项时
    // undo:last 自身回 ok:false、什么都不发生；按钮仍按 info 结果显隐
    "review.undo": { when: () => (mixed || canUndo) && !actionBusyRef.current && !saveError, run: () => doUndo() },
    "review.markSuspend": { when: () => hasCard && !actionBusyRef.current && !saveError, run: () => void markAndSuspend() },
    "review.skip": { when: () => hasCard && !actionBusyRef.current && !saveError, run: () => void skip() },
    "review.delete": { when: () => hasCard && !actionBusyRef.current && !saveError, run: () => void handleDelete() },
    // D121 §3.1：辨析（答案翻开前后均可用；弹窗内按键由全局分发器的 dialog 守卫放行）
    "review.disambiguate": { when: () => hasCard && !actionBusyRef.current && !saveError && !disamb, run: () => setDisamb({}) }
  });

  // v34（M12，§4.16）：延后原因可读化——reviewed=同源卡今日已评分；revealed=同组今日放行名额已被占
  function deferReasonText(r?: TodayQueue["deferred"][number]["deferReason"]): string {
    if (!r) return T("同源卡今日已放行");
    const f = r.siblingFront ? `${r.siblingFront.slice(0, 20)}${r.siblingFront.length > 20 ? "…" : ""}` : "";
    return r.kind === "reviewed"
      ? T("同源卡今日已评分：「{front}」", { front: f })
      : f
        ? T("与今日已放行的「{front}」同源", { front: f })
        : T("与今日已放行的同源卡同源");
  }

  const deferredPanel = deferred.length > 0 && (
    <div className="review-deferred">
      <button className="review-jump" onClick={() => setDeferredOpen((v) => !v)}>
        {T("同源暂缓 {n} 张（明日自动解封）", { n: deferred.length })}
      </button>
      {deferredOpen && (
        <ul className="deferred-list">
          {deferred.map((c) => (
            <li key={c.id}>
              <span className="deferred-reason mono">{deferReasonText(c.deferReason)}</span>
              <span className="deferred-front">{(c.frontMarkdown || c.noteText || "").slice(0, 44)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  // ---------- 混合复习的摘录条目（v48.22 / D58；v49.61 / D232 补齐） ----------
  // 处理完一条摘录 → 取会话下一条（可能是卡，也可能又是摘录）
  const afterExtract = useCallback(async () => {
    const nx = await nextCard();
    setCurrent(nx ?? null);
    if (nx) {
      setShowBack(false);
      setStartedAt(Date.now());
    }
    setSessionDone(!nx && extractHeadRef.current === null);
    void refreshUndo();
  }, [nextCard, refreshUndo]);
  /** D232：推进 / 推迟 / 毕业共用的执行壳——busy 守卫（连按两次「下一条」不再把同一条推进两次）、
      失败停在原条、成功广播 workflow/changed 后取下一条 */
  const runExtractStep = useCallback(
    async (op: () => Promise<unknown>) => {
      if (actionBusyRef.current) return;
      actionBusyRef.current = true;
      try {
        try {
          await op();
        } catch {
          return;
        }
        eventBus.emit("workflow/changed");
        await afterExtract();
      } finally {
        actionBusyRef.current = false;
      }
    },
    [afterExtract]
  );
  // D232：摘录条目上的「下一条」键——与摘录页同口径（只认不带修饰键的空格 / 回车；打字、控件原生键、
  // 对话框内、长按连发一律不触发）。撤销键走 review.undo 命令（混合复习下＝统一撤销链）
  const currentExtractId = currentExtract?.id ?? null;
  useEffect(() => {
    if (!currentExtractId) return;
    const onKey = (e: KeyboardEvent) => {
      if (isImeComposing(e)) return;
      if (e.defaultPrevented) return;
      if (isTextEntryTarget(e.target) || isNativeControlKey(e)) return;
      if (isInModal(e.target)) return;
      const plain = !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey;
      if (!plain || (e.key !== " " && e.key !== "Enter")) return;
      e.preventDefault();
      if (e.repeat) return;
      void runExtractStep(() => readingWorkflow.advance(currentExtractId));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [currentExtractId, runExtractStep]);

  /* ---------- D240（MOTION-DESIGN-SPEC §18.2 末条）：复习页首卡抑制——摘录页 R2-5 同款 ----------
     页面进入（顶栏 / 阅读器返回 / 卡片浏览器「开始复习」等跨视图入口，本组件随之重挂载）后的
     **首张卡**不播 stage-card-in：入场完全由 §5.1 方向性页面过渡承担（书架 / 摘录 → 复习自右往左，
     推荐 / 卡片 / 数据 → 复习自左往右）。原先闪卡 .review-flip 的 stage-card-in 不挂闸门、数据在过渡
     遮罩期内到达 ⇒ 卡面在新页快照里自右滑入 24px（页面位移的 3 倍），返回方向（bwd）时与页面反向；
     混合复习的摘录卡面挂闸门 ⇒ 揭幕后又补播一次自右往左。同视图内换卡（评分推进 / 摘录下一条 /
     撤销）stage-card-in 照常。卡面由共用组件（CardFace / ExtractCardFace）渲染，宿主不越界改它，
     标记按等价语义落在 .review-wrap（data-first-card）。 */
  /** 当前显示的条目：闪卡 c:<id>、混合复习推到的摘录 x:<id>；加载中 / 空态＝null */
  const shownKey = loading ? null : currentExtract ? `x:${currentExtract.id}` : current ? `c:${current.id}` : null;
  /** 首卡标记（live/key 机制，与 ExtractReviewView 同口径）：key=undefined＝尚未记录；live＝被标记的
      首卡元素仍在场。加载完成后的首个渲染即记录（空态进入则 live=false：之后到来的卡属页内变化，照常播）。
      渲染期**只读不写**（StrictMode 双渲染读到同值），记录在下方 layout effect（绘制前，与提交同帧）。
      换卡 / 换条（key 变化）当帧标记随新卡一同摘除 ⇒ 新卡首帧即播 stage-card-in；被标记卡存续期恒带
      标记——中途摘除会让 stage-card-in 迟到重放（动画名由 none 复现即起播）。 */
  const firstCardMarkRef = useRef<{ key: string | null | undefined; live: boolean }>({ key: undefined, live: true });
  useLayoutEffect(() => {
    const mark = firstCardMarkRef.current;
    if (loading || !mark.live) return;
    if (mark.key === undefined) firstCardMarkRef.current = { key: shownKey, live: shownKey !== null };
    else if (mark.key !== shownKey) firstCardMarkRef.current = { key: shownKey, live: false };
  }, [loading, shownKey]);
  const firstCardMark = firstCardMarkRef.current;
  const isFirstCardEl =
    shownKey !== null && firstCardMark.live && (firstCardMark.key === undefined || firstCardMark.key === shownKey);

  if (loading) {
    return (
      <div className="review-wrap">
        <div className="empty-state"><p className="empty-text">{T("加载中…")}</p></div>
      </div>
    );
  }

  // v48.22（D58 §6.8-3）：合并会话推送到摘录时，用**与摘录页同一张卡面**就地处理
  if (currentExtract) {
    const ex = currentExtract;
    // D232：改优先级 / 编辑正文只就地更新当前条（不重排、不换条——与摘录页 D226 钉卡同口径），
    // 并把新值回写进卡面（原实现不回写：编辑后读态仍显示旧正文，直到换条）
    const patchCurrent = (patch: Partial<DueTopic>) =>
      setCurrentExtract((cur) => {
        if (!cur || cur.id !== ex.id) return cur;
        const next = { ...cur, ...patch };
        extractHeadRef.current = next;
        return next;
      });
    // 动作集：同一个对象喂给卡面与底栏（v2 §8.4）
    const exHandlers = {
      onAdvance: () => void runExtractStep(() => readingWorkflow.advance(ex.id)),
      onPostpone: (days: number) => void runExtractStep(() => readingWorkflow.postponeDays(ex.id, days)),
      onPriority: (p: number) =>
        void readingWorkflow.setPriority(ex.id, p).then(
          () => {
            patchCurrent({ priority: p, prioritySource: "user" });
            void refreshUndo();
          },
          () => undefined
        ),
      onGraduate: () => void runExtractStep(() => readingWorkflow.graduate(ex.id)),
      onEdit: (text: string) =>
        void readingWorkflow.updateContent(ex.id, text).then(
          () => {
            patchCurrent({ contentMarkdown: text });
            eventBus.emit("workflow/changed");
            void refreshUndo();
          },
          () => undefined
        ),
      onJumpToSource:
        onJumpToDoc && ex.contextRef?.documentId
          ? () =>
              onJumpToDoc(ex.contextRef!.documentId!, {
                anchorText: ex.contextRef!.anchorText || ex.contentMarkdown,
                anchorRatio: ex.contextRef!.anchorRatio
              })
          : undefined,
      onUndo: () => doUndo()
    };
    return (
      /* D240：首卡抑制标记（见上方 live/key 机制）——混合复习推到的摘录卡面同样只随页面过渡入场 */
      <div className="review-wrap" data-first-card={isFirstCardEl ? "1" : undefined}>
        {/* 头带：全宽吸顶（与摘录页同一配方），计数在最右 */}
        <div className="review-head">
          <div className="review-head-inner">
            <div className="review-count mono">{T("摘录 · 混合复习")}</div>
          </div>
        </div>
        <div className="review-session">
          <ExtractCardFace key={ex.id} extract={ex} handlers={exHandlers} />
        </div>
        {/* 底栏：滚动根的最后一个流内子节点（sticky bottom:0），与摘录页几何构造性相等 */}
        <ExtractActionsBar extract={ex} handlers={exHandlers} />
      </div>
    );
  }

  if (!current && sessionDone) {
    return (
      <div className="review-wrap">
        {/* 头带（计数在最右）+ 居中空态；无底栏（v2 §5：Empty 无 bar）。
            D88 §7.2：进度轨随头带（收尾页分母>0 时呈满格——doneCount/分母=100%）。 */}
        <div className="review-head">
          <div className="review-head-inner">
            <div className="review-count mono">{T("{n} 张已复习", { n: doneCount })}</div>
          </div>
          {progressDenominator > 0 && (
            <div
              className="review-progress"
              role="progressbar"
              aria-label={T("今日复习进度")}
              aria-valuemin={0}
              aria-valuemax={progressDenominator}
              aria-valuenow={doneCount}
            >
              <b style={{ width: `${progressPct}%` }} />
            </div>
          )}
        </div>
        <div className="review-session">
          <div className="empty-state">
            <p className="empty-text">
              {doneCount > 0 ? T("到期卡片已清空，休息一下。") : T("今日到期卡片已清空。")}
            </p>
            {deferredPanel}
            {/* v48.85（D129 B3，§5.2）：会话成果汇总——deferredPanel 之后；仅 doneCount>0 时驱动
                growthAPI.sessionSummary(sessionStartTs)；空命中组件自身零渲染（禁负面对照） */}
            {doneCount > 0 && <GrowthSessionSummary fromTs={sessionStartTs} />}
            <div className="settings-row">
              {canUndo && (
                <button className="btn btn-secondary btn-sm" onClick={doUndo}>
                  {undoLabel}
                </button>
              )}
              <button className="btn btn-secondary btn-sm" onClick={() => window.location.reload()}>
                {T("刷新")}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    /* D240：首卡抑制标记（见上方 live/key 机制）——首张闪卡（.review-flip）只随页面过渡入场 */
    <div className="review-wrap" data-first-card={isFirstCardEl ? "1" : undefined}>
      {/* 头带：全宽吸顶（与摘录页同一配方；计数恒最右）。它是滚动内容的第 1 个流内子节点，
          计数不再随卡片滚走。 */}
      <div className="review-head">
        <div className="review-head-inner">
          {/* 顶栏＝Anki 式三档计数（今日可用口径，见 sessionAPI.counts）；不再有「本轮 N 张」与
              「点击卡片或按空格显示答案」那行提示（2026-10-01 用户裁定：翻面改按钮、提示并入按钮 hover）。
              D88 §7.2：内部升级为预览 .qi 三块（8px 色点 + 20px/300 tabular 数字）；容器类与
              三档文案保留（m4/m12 断言钩子），色点＝未学习 --grey-3 · 学习中 --warning · 待复习 --accent。 */}
          <div className="review-count" data-review-counts>
            <span className="qi">
              <span className="lab">
                {T("未学习")}
              </span>
              <span className={`qi-num${bumpKeys.new ? " bump" : ""}`}>{counts.new}</span>
            </span>
            <span className="qi">
              <span className="lab">
                {T("学习中")}
              </span>
              <span className={`qi-num${bumpKeys.learning ? " bump" : ""}`}>{counts.learning}</span>
            </span>
            <span className="qi">
              <span className="lab">
                {T("待复习")}
              </span>
              <span className={`qi-num${bumpKeys.review ? " bump" : ""}`}>{counts.review}</span>
            </span>
          </div>
        </div>
        {/* D88 §7.2 进度轨：真实分母，分母 0 不渲染（禁假动画）；填色＝--accent（设计基准黑→主题色） */}
        {progressDenominator > 0 && (
          <div
            className="review-progress"
            role="progressbar"
            aria-label="今日复习进度"
            aria-valuemin={0}
            aria-valuemax={progressDenominator}
            aria-valuenow={doneCount}
          >
            <b style={{ width: `${progressPct}%` }} />
          </div>
        )}
      </div>

      <div className="review-session" data-ui="review-card">
        {deferredPanel}

        {/* v23（§4.4.9）：persist 失败横幅——停留当前卡、封锁动作，重试成功后自动恢复 */}
        {saveError && (
          <div className="save-error" role="alert">
            <span>{T("保存失败：刚才的操作尚未写入磁盘，已停留在本卡。")}</span>
            <button
              className="btn btn-secondary btn-sm"
              onClick={async () => {
                try {
                  await cardsApi.persistNow();
                  setSaveError(false);
                } catch { /* 仍失败则保持错误态 */ }
              }}
            >
              {T("重试保存")}
            </button>
          </div>
        )}

        {previewError && (
          <div className="save-error" role="alert">
            <span>{T("这张卡的调度状态无法解析，已暂停对它评分：{msg}", { msg: previewError })}</span>
          </div>
        )}

        {/* 翻面只走底栏按钮（2026-10-01）：卡面不再吃点击（onReveal 不传＝点卡面不翻面）。
            key＝卡 id：换卡即重挂载 ⇒ 入场动效（--dur-stage 240ms，见 theme.css）在一次呈现里恰好触发一次；
            翻面态 showBack 由父持有，不受 remount 影响。
            D88 §7.3：CardFace 双面常挂（.review-flip 3D 翻卡），翻面在此只翻 flipped 类与 inert 对调。 */}
        <CardFace key={current!.id} card={current!} showBack={showBack} onEdit={handleEdit} />
        {/* v48.85（D129 B2，§5.1）：微反馈条——CardFace 之后的条件渲染，绝对定位浮层不占布局流；
            key 含 n：同键事件再次触发时强制重挂（旧条直卸重起新条，§5.1「替换」行） */}
        {growthToast && (
          <GrowthToast
            key={`${growthToast.hit.key}:${growthToast.n}`}
            hit={growthToast.hit}
            onDone={() => setGrowthToast(null)}
          />
        )}
        {/* 信息行（2026-10-01 建立；v48.41/D81：**来源上移顶栏中间**（onMaterialName 链路），行内只留日期 */}
        <div className="review-meta">
          {current!.dateStamp ? current!.dateStamp : ""}
        </div>
        {/* v48.60（D101）：答案揭示后的标签区——chips 只读 + 快捷添加（**正面永不显示**，防泄题 R6 同源）；
            v48.63（D107）：标签功能总开关关闭时整块不渲染 */}
        {showBack && tagsEnabled && (
          <div className="review-tags" data-testid="review-tags">
            {(current!.tags ?? []).map((t) => (
              <span key={t} className="tag-chip tag-chip-static">
                {t}
              </span>
            ))}
            <button
              className="bar-btn ghost review-tag-add"
              data-testid="review-tag-add"
              title={T("给这张卡加标签（如「错题」），可在卡片浏览器按 tag: 筛选")}
              onClick={() => {
                setTagOpen((v) => !v);
                setTagDraft([]);
              }}
            >
              {T("＋ 标签")}
            </button>
            {tagOpen && (
              <span className="review-tag-editor">
                <TagInput value={tagDraft} onChange={setTagDraft} suggestions={tagVocab} ariaLabel={T("标签")} placeholder={T("输入标签，回车确认")} />
                <button className="btn btn-primary btn-sm" data-testid="review-tag-apply" disabled={tagDraft.length === 0} onClick={() => void applyQuickTags()}>
                  {T("保存")}
                </button>
              </span>
            )}
          </div>
        )}
        {/* v48.61（D104）：背面辅助字段区——助记/例子/来源三块统一受 app.cardFaceExtras 开关控制
            （此前只渲染 mnemonic，example/sourceRef 全库无消费点位，本批补齐为三块统一） */}
        {showBack && <CardFaceExtrasBlock card={current!} />}
        {/* D121 §3.5：已辨析提示——仅答案翻开后显示（翻开前显示对端题面会泄题）；点击直达第二屏 */}
        {showBack && (() => {
          const link = latestLink(cardLinks);
          if (!link) return null;
          const label = link.verdict ? T(VERDICT_LABELS[link.verdict]) : null;
          return (
            <button
              type="button"
              className="review-disamb-hint"
              data-testid="review-disamb-hint"
              title={T("查看或修改这次辨析")}
              onClick={() => setDisamb(link.other ? { presetOther: link.other.id } : {})}
            >
              {disambHintText(link.other, label, T)}
            </button>
          );
        })()}
      </div>

      {/* 底栏（v2）：挂在滚动根（.review-wrap）的**最后一个子节点**上——sticky 时代它必须直接位于滚动根下
          才能满宽 + 正确钉底（fixed 时代它藏在 .review-session 里无所谓）。
          D88 §7.4/§7.5：「显示答案」＝填充主钮（settle+涟漪）；评分四钮改两行色点卡式钮（推荐档 accent
          填充加高）；.review-bar-side / .bar-more / .bar-pop 内部结构不变。 */}
      <div className="stage-bar review-bar" data-review-bar>
        {/* D90：内容列与 .review-session 同盒（720 居中，静态对齐） */}
        <div className="stage-bar-inner">
        {!showBack ? (
          <button
            ref={revealBtnRef}
            className="bar-btn primary grow"
            data-reveal
            disabled={saveError || !current}
            title={T("显示答案（快捷键：{hint}，可在设置里改）", { hint: hint || T("未绑定") })}
            onClick={(e) => {
              // D88 §4.2：settle 回弹＝真实点击主 CTA 的按压反馈（animationend 自摘）
              settle(e.currentTarget);
              setShowBack(true);
            }}
          >
            {T("显示答案")}
          </button>
        ) : (
          <div className="grade-row grade-grid">
            {/* D88 §7.4 评分 CTA：两行结构（色点+档名 / 间隔预览）；语义色唯一承载＝色点；
                推荐档 Good＝accent 填充加高（Staging）；点击 settle；涟漪仅推荐档（§4.3 白名单）。 */}
            {(previews?.items ?? safePreviewItems(current!.fsrs)).map((p) => {
              const recommended = p.rating === "Good";
              const gradeHint = bindingHint(`review.${p.rating.toLowerCase()}`);
              return (
                <button
                  key={p.rating}
                  ref={recommended ? goodBtnRef : undefined}
                  className={`grade grade-${p.rating.toLowerCase()}${recommended ? " recommended" : ""}`}
                  disabled={saveError}
                  title={T("{label}（快捷键：{hint}）· 间隔 {due}", { label: T(RATING_LABEL[p.rating]), hint: gradeHint || T("未绑定"), due: p.dueText })}
                  onClick={(e) => {
                    settle(e.currentTarget);
                    void grade(p.rating);
                  }}
                >
                  <span className="grade-name">
                    {T(RATING_LABEL[p.rating])}
                  </span>
                  <span className="grade-due mono">{p.dueText}</span>
                </button>
              );
            })}
          </div>
        )}
        <span className="review-bar-side">
          {/* v48.58（D99）：AI 判答入口——正反两面恒在，无标准答案文本的卡禁用 */}
          <button
            className="bar-btn ghost"
            data-testid="review-judge-btn"
            disabled={!canJudge || saveError}
            title={canJudge ? T("AI 判答：把你的答案交给 AI，与标准答案比对是否等价") : T("该卡没有标准答案文本，无法 AI 判答")}
            onClick={() => setJudgeOpen(true)}
          >
            {T("AI 判答")}
          </button>
          {current!.contextRef?.documentId && onJumpToDoc && current!.contextRef.imageSource !== "library" && (
            hasSourceAnchor(current!.contextRef) ? (
              <button className="bar-btn ghost" onClick={handleJumpToSource} title={T("跳转原文（不写入阅读进度）")}>
                {T("跳转原文")}
              </button>
            ) : (
              <button className="bar-btn ghost" disabled title={T("该卡制卡时未记录原文位置（旧卡），无法跳转")}>
                {T("跳转原文")}
              </button>
            )
          )}
          {current!.cardType === "imageOcclusion" && current!.occlusionJson && (
            <button className="bar-btn ghost" onClick={() => setLightboxOpen(true)}>
              {T("查看原图")}
            </button>
          )}
          <span className="bar-more" data-menu ref={barMoreRef}>
            <button className="bar-btn ghost" data-toggle aria-expanded={barMoreOpen} onClick={() => setBarMoreOpen((v) => !v)}>
              {T("更多")}<span className="caret">▲</span>
            </button>
            {barMoreOpen && (
              <div className="bar-pop" data-pop>
                {canUndo && (
                  <button
                    onClick={() => {
                      setBarMoreOpen(false);
                      doUndo();
                    }}
                  >
                    {undoLabel}<span className="k mono">{bindingHint("review.undo")}</span>
                  </button>
                )}
                <button
                  onClick={() => {
                    setBarMoreOpen(false);
                    setDisamb({});
                  }}
                >
                  {T("辨析 / 有疑问")}<span className="k mono">{bindingHint("review.disambiguate")}</span>
                </button>
                <button
                  onClick={() => {
                    setBarMoreOpen(false);
                    markAndSuspend();
                  }}
                >
                  {T("标记并暂停")}<span className="k mono">Q</span>
                </button>
                {/* v48.60（D102）：不再关心＝归档（cards.status），与「标记并暂停」（Leech 挂起）正交。
                    v49.45（D216）：文案统一——原「不再关心（归档）」与卡详情/批量栏/「已归档」页签统一叫「归档」+ title */}
                <button
                  data-testid="review-archive"
                  title={T("移出复习与默认列表，可在『已归档』页签恢复")}
                  onClick={() => {
                    setBarMoreOpen(false);
                    void archiveAndNext();
                  }}
                >
                  {T("归档")}
                </button>
                <button
                  onClick={() => {
                    setBarMoreOpen(false);
                    skip();
                  }}
                >
                  {T("跳过")}<span className="k mono">W</span>
                </button>
                <button
                  className="danger"
                  onClick={() => {
                    setBarMoreOpen(false);
                    handleDelete();
                  }}
                >
                  {T("删除")}<span className="k mono">D</span>
                </button>
              </div>
            )}
          </span>
        </span>
        </div>
      </div>
      {judgeOpen && current && (
        <AnswerJudgeModal card={current} onClose={() => setJudgeOpen(false)} />
      )}
      {disamb && current && (
        <DisambiguateModal
          card={current}
          presetOther={disamb.presetOther}
          origin="review"
          onClose={(r) => void handleDisambClose(r)}
        />
      )}
    </div>
  );
}
