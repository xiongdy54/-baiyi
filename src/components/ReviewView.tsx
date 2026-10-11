// 连续刷题复习界面（v11.1 连续模式；v12.2 去页内重复标题 + 跳转原文 + 删除按钮）：
// 进入即开始；评分后自动展示下一张到期卡。每张卡都重新拉取今日队列取队首，
// 口径 = 今日队列视图（v34/M12 §4.2-20：FSRS due 升序 + 同 due 优先级降序 + 同源卡延后），学习中新到期卡实时进入队列。
import { useCallback, useEffect, useRef, useState } from "react";
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
import { readingWorkflow, undoApi, type DueTopic } from "../lib/readingWorkflow";
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

// A-1（审计）：渲染期调用不得抛。原写法 `previews?.items ?? fsrsEngine.preview(current!.fsrs)`
// 在 previews 为 null 时会同步抛，被根错误边界接管 → 整应用停止渲染。这里降级为空列表。
function safePreviewItems(fsrs: unknown): ReturnType<typeof fsrsEngine.preview> {
  try { return fsrsEngine.preview(fsrs as never); } catch { return []; }
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
  const tagsEnabled = useTagsEnabled();
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
  /** 显示答案的**生效**快捷键（随设置变化；不许把「空格」写死） */
  const hint = bindingHint("review.showAnswer");
  const [startedAt, setStartedAt] = useState(Date.now());
  const [loading, setLoading] = useState(true);
  const [doneCount, setDoneCount] = useState(0);
  const [sessionDone, setSessionDone] = useState(false);
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

  // 查询最近可撤销评分（评分/撤销后刷新；挂起/跳过/删除不产生日志无需刷新，删除他人卡由撤销时服务端兜底）
  const refreshUndo = useCallback(async () => {
    setUndoInfo((await cardsApi.lastUndoableReview()) ?? null);
  }, []);

  useEffect(() => {
    void refreshUndo();
  }, [refreshUndo]);

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

  const nextCard = useCallback(async (): Promise<(CardRecord & { docTitle?: string }) | null> => {
    const scope = bookItemIds?.length || (scopeLimits && Object.keys(scopeLimits).length) || scopeTags?.length || scopeKpIds?.length
      ? { bookItemIds: bookItemIds ?? undefined, tags: scopeTags, kpIds: scopeKpIds, limits: scopeLimits ?? undefined }
      : undefined;
    const session = await fetchSessionQueue({ scope });
    if (session) {
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
        setLoading(false);
        return;
      }
      const c = await nextCard();
      if (cancelled) return;
      if (c) {
        setCurrent(c);
        setShowBack(false);
        setStartedAt(Date.now());
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
      // Leech 检测（§8.7 + §11.4 字段级更新）
      if (fsrsEngine.isLeech(lapses, 8) && !(current.leech?.isLeech)) {
        try {
          await cardsApi.addIssue({
            cardId: current.id,
            ruleId: "LEECH",
            severity: "warn",
            message: `连续遗忘 ${lapses} 次，已自动暂停`,
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
          message: "复习中标记待改",
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
    if (!window.confirm(`确定删除这张卡片？\n\n${current.frontMarkdown || current.noteText}`)) return;
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
  // D99：AI 判答需要标准答案文本可比（挖空缺省态等无 backMarkdown 的卡禁用）
  const canJudge = !!current && !!(current.backMarkdown && current.backMarkdown.trim());
  useCommandActions("review", {
    "review.showAnswer": { when: () => hasCard && !showBack && !actionBusyRef.current, run: () => setShowBack(true) },
    "review.again": { when: () => canGrade && !actionBusyRef.current && !saveError, run: () => void grade("Again") },
    "review.hard": { when: () => canGrade && !actionBusyRef.current && !saveError, run: () => void grade("Hard") },
    "review.good": { when: () => canGrade && !actionBusyRef.current && !saveError, run: () => void grade("Good") },
    "review.easy": { when: () => canGrade && !actionBusyRef.current && !saveError, run: () => void grade("Easy") },
    "review.undo": { when: () => !!undoInfo && !actionBusyRef.current && !saveError, run: () => void undoLastGrade() },
    "review.markSuspend": { when: () => hasCard && !actionBusyRef.current && !saveError, run: () => void markAndSuspend() },
    "review.skip": { when: () => hasCard && !actionBusyRef.current && !saveError, run: () => void skip() },
    "review.delete": { when: () => hasCard && !actionBusyRef.current && !saveError, run: () => void handleDelete() },
    // D121 §3.1：辨析（答案翻开前后均可用；弹窗内按键由全局分发器的 dialog 守卫放行）
    "review.disambiguate": { when: () => hasCard && !actionBusyRef.current && !saveError && !disamb, run: () => setDisamb({}) }
  });

  // v34（M12，§4.16）：延后原因可读化——reviewed=同源卡今日已评分；revealed=同组今日放行名额已被占
  function deferReasonText(r?: TodayQueue["deferred"][number]["deferReason"]): string {
    if (!r) return "同源卡今日已放行";
    const f = r.siblingFront ? `「${r.siblingFront.slice(0, 20)}${r.siblingFront.length > 20 ? "…" : ""}」` : "";
    return r.kind === "reviewed" ? `同源卡今日已评分：${f}` : `与今日已放行的${f || "同源卡"}同源`;
  }

  const deferredPanel = deferred.length > 0 && (
    <div className="review-deferred">
      <button className="review-jump" onClick={() => setDeferredOpen((v) => !v)}>
        同源暂缓 {deferred.length} 张（明日自动解封）
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

  if (loading) {
    return (
      <div className="review-wrap">
        <div className="empty-state"><p className="empty-text">加载中…</p></div>
      </div>
    );
  }

  // v48.22（D58 §6.8-3）：合并会话推送到摘录时，用**与摘录页同一张卡面**就地处理
  if (currentExtract) {
    const ex = currentExtract;
    const after = async () => {
      const nx = await nextCard();
      setCurrent(nx ?? null);
      if (nx) {
        setShowBack(false);
        setStartedAt(Date.now());
      }
      setSessionDone(!nx && extractHeadRef.current === null);
    };
    // 动作集：同一个对象喂给卡面与底栏（v2 §8.4）
    const exHandlers = {
      onAdvance: () => void readingWorkflow.advance(ex.id).then(after),
      onPostpone: (days: number) => void readingWorkflow.postponeDays(ex.id, days).then(after),
      onPriority: (p: number) => void readingWorkflow.setPriority(ex.id, p),
      onGraduate: () => void readingWorkflow.graduate(ex.id).then(after),
      onEdit: (text: string) => void readingWorkflow.updateContent(ex.id, text),
      onJumpToSource:
        onJumpToDoc && ex.contextRef?.documentId
          ? () =>
              onJumpToDoc(ex.contextRef!.documentId!, {
                anchorText: ex.contextRef!.anchorText || ex.contentMarkdown,
                anchorRatio: ex.contextRef!.anchorRatio
              })
          : undefined,
      onUndo: () => void undoApi.last().then(after)
    };
    return (
      <div className="review-wrap">
        {/* 头带：全宽吸顶（与摘录页同一配方），计数在最右 */}
        <div className="review-head">
          <div className="review-head-inner">
            <div className="review-count mono">摘录 · 合并复习</div>
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
            <div className="review-count mono">{doneCount} 张已复习</div>
          </div>
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
        <div className="review-session">
          <div className="empty-state">
            <p className="empty-text">
              {doneCount > 0 ? "到期卡片已清空，休息一下。" : "今日到期卡片已清空。"}
            </p>
            {deferredPanel}
            <div className="settings-row">
              {undoInfo && (
                <button className="btn btn-secondary btn-sm" onClick={undoLastGrade}>
                  撤销评分{undoInfo.rating ? `（${undoInfo.rating}）` : ""}
                </button>
              )}
              <button className="btn btn-secondary btn-sm" onClick={() => window.location.reload()}>
                刷新
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="review-wrap">
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
                未学习
              </span>
              <span className={`qi-num${bumpKeys.new ? " bump" : ""}`}>{counts.new}</span>
            </span>
            <span className="qi">
              <span className="lab">
                学习中
              </span>
              <span className={`qi-num${bumpKeys.learning ? " bump" : ""}`}>{counts.learning}</span>
            </span>
            <span className="qi">
              <span className="lab">
                待复习
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

      <div className="review-session">
        {deferredPanel}

        {/* v23（§4.4.9）：persist 失败横幅——停留当前卡、封锁动作，重试成功后自动恢复 */}
        {saveError && (
          <div className="save-error" role="alert">
            <span>保存失败：刚才的操作尚未写入磁盘，已停留在本卡。</span>
            <button
              className="btn btn-secondary btn-sm"
              onClick={async () => {
                try {
                  await cardsApi.persistNow();
                  setSaveError(false);
                } catch { /* 仍失败则保持错误态 */ }
              }}
            >
              重试保存
            </button>
          </div>
        )}

        {previewError && (
          <div className="save-error" role="alert">
            <span>这张卡的调度状态无法解析，已暂停对它评分：{previewError}</span>
          </div>
        )}

        {/* 翻面只走底栏按钮（2026-10-01）：卡面不再吃点击（onReveal 不传＝点卡面不翻面）。
            key＝卡 id：换卡即重挂载 ⇒ 入场动效（--dur-stage 240ms，见 theme.css）在一次呈现里恰好触发一次；
            翻面态 showBack 由父持有，不受 remount 影响。
            D88 §7.3：CardFace 双面常挂（.review-flip 3D 翻卡），翻面在此只翻 flipped 类与 inert 对调。 */}
        <CardFace key={current!.id} card={current!} showBack={showBack} onEdit={handleEdit} />
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
              title="给这张卡加标签（如「错题」），可在卡片浏览器按 tag: 筛选"
              onClick={() => {
                setTagOpen((v) => !v);
                setTagDraft([]);
              }}
            >
              ＋ 标签
            </button>
            {tagOpen && (
              <span className="review-tag-editor">
                <TagInput value={tagDraft} onChange={setTagDraft} suggestions={tagVocab} ariaLabel="标签" placeholder="输入标签，回车确认" />
                <button className="btn btn-primary btn-sm" data-testid="review-tag-apply" disabled={tagDraft.length === 0} onClick={() => void applyQuickTags()}>
                  保存
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
          const label = link.verdict ? VERDICT_LABELS[link.verdict] : null;
          return (
            <button
              type="button"
              className="review-disamb-hint"
              data-testid="review-disamb-hint"
              title="查看或修改这次辨析"
              onClick={() => setDisamb(link.other ? { presetOther: link.other.id } : {})}
            >
              {disambHintText(link.other, label)}
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
            title={`显示答案（快捷键：${hint || "未绑定"}，可在设置里改）`}
            onClick={(e) => {
              // D88 §4.2：settle 回弹＝真实点击主 CTA 的按压反馈（animationend 自摘）
              settle(e.currentTarget);
              setShowBack(true);
            }}
          >
            显示答案
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
                  title={`${RATING_LABEL[p.rating]}（快捷键：${gradeHint || "未绑定"}）· 间隔 ${p.dueText}`}
                  onClick={(e) => {
                    settle(e.currentTarget);
                    void grade(p.rating);
                  }}
                >
                  <span className="grade-name">
                    {RATING_LABEL[p.rating]}
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
            title={canJudge ? "AI 判答：把你的答案交给 AI，与标准答案比对是否等价" : "该卡没有标准答案文本，无法 AI 判答"}
            onClick={() => setJudgeOpen(true)}
          >
            AI 判答
          </button>
          {current!.contextRef?.documentId && onJumpToDoc && current!.contextRef.imageSource !== "library" && (
            hasSourceAnchor(current!.contextRef) ? (
              <button className="bar-btn ghost" onClick={handleJumpToSource} title="跳转原文（不写入阅读进度）">
                跳转原文
              </button>
            ) : (
              <button className="bar-btn ghost" disabled title="该卡制卡时未记录原文位置（旧卡），无法跳转">
                跳转原文
              </button>
            )
          )}
          {current!.cardType === "imageOcclusion" && current!.occlusionJson && (
            <button className="bar-btn ghost" onClick={() => setLightboxOpen(true)}>
              查看原图
            </button>
          )}
          <span className="bar-more" data-menu ref={barMoreRef}>
            <button className="bar-btn ghost" data-toggle aria-expanded={barMoreOpen} onClick={() => setBarMoreOpen((v) => !v)}>
              更多<span className="caret">▲</span>
            </button>
            {barMoreOpen && (
              <div className="bar-pop" data-pop>
                {undoInfo && (
                  <button
                    onClick={() => {
                      setBarMoreOpen(false);
                      undoLastGrade();
                    }}
                  >
                    撤销评分{undoInfo.rating ? `（${undoInfo.rating}）` : ""}<span className="k mono">Z</span>
                  </button>
                )}
                <button
                  onClick={() => {
                    setBarMoreOpen(false);
                    setDisamb({});
                  }}
                >
                  辨析 / 有疑问<span className="k mono">{bindingHint("review.disambiguate")}</span>
                </button>
                <button
                  onClick={() => {
                    setBarMoreOpen(false);
                    markAndSuspend();
                  }}
                >
                  标记并暂停<span className="k mono">Q</span>
                </button>
                {/* v48.60（D102）：不再关心＝归档（cards.status），与「标记并暂停」（Leech 挂起）正交 */}
                <button
                  data-testid="review-archive"
                  onClick={() => {
                    setBarMoreOpen(false);
                    void archiveAndNext();
                  }}
                >
                  不再关心（归档）
                </button>
                <button
                  onClick={() => {
                    setBarMoreOpen(false);
                    skip();
                  }}
                >
                  跳过<span className="k mono">W</span>
                </button>
                <button
                  className="danger"
                  onClick={() => {
                    setBarMoreOpen(false);
                    handleDelete();
                  }}
                >
                  删除<span className="k mono">D</span>
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
