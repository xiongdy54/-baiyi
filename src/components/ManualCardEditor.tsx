// 手动制卡编辑器（Phase 3：引用 + 可编辑副本；M1.1 增翻转问答；M5/v25 字段对齐 AI 制卡）
// 批 4（Task 4）：从 Reader.tsx 原样搬出（纯移动，零行为改动）——摘录页与阅读器共用同一份实现。
// UdcPicker 只被本文件使用，一并搬入。
// D88 P3（§8.2）：表单体抽为命名导出 `ManualCardForm`（props 与原组件一致，去掉 modal 包装；
// 纯移动，逻辑零改动）——CardDock 手动态直接渲染它。默认导出 `ManualCardEditor` 保留为
// 「modal 包装 + ManualCardForm」：**图片挖空**（imageOcclusion，来自图片聚焦工具条）继续走
// modal（大图预览需要幅面），其余三模式走 dock——m6 系列图片挖空断言零迁移。
// v48.100（D144 #4）：跨页签幽灵草稿同步的手动侧落点——第一文本框（四题型同为 front state：
// 问答/翻转/图片挖空＝正面，填空＝挖空文本）值镜像上报（onFrontChange，宿主只读不回写——无损红线）；
// ManualFormHandle.setFrontValue 写入源全文并聚焦、光标落文末；幽灵层经 ghost/onGhostAccept
// 渲染进第一字段（GrowField，Alt+Enter 坞内固定键）。表单其余内部状态、载荷、题型页签零改动。
import { forwardRef, useImperativeHandle, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { isImeComposing } from "../lib/ime";
import { cardsApi, needsDateStamp, parseCloze, similaritySearch } from "../lib/cards";
import { bigramJaccard } from "../lib/disambiguateCore.mjs";
import { PRECHECK_K, answerDiffers, clipText, manualPrecheckText, shouldRunPrecheck } from "../lib/disambiguateUi";
import { UDC_LEAVES, UDC_MAX, UDC_OTHER, udcLabel } from "../lib/udc";
import { useDialogA11y } from "../lib/dialogA11y";
import { attachRipple, settle } from "../lib/press";
import { IconChevronDown, IconClose } from "./icons";
import OcclusionShapes from "./OcclusionShapes";
// C-34b：字段编辑器抽到 editor/CardFields.tsx（制卡台与复习页/浏览器卡面共用同一套）——纯移动
import { ClozeField, GrowField, MdField } from "./editor/CardFields";
import TagInput from "./TagInput";
import { useT } from "../lib/i18n";
// v48.63（D107）：标签功能总开关——手动表单标签行受其控制
import { useTagsEnabled } from "../lib/tagSettings";
import type { TagVocabEntry } from "../lib/tags";
import type { OcclusionRect, OcclusionShape } from "../lib/occlusion";

/** D123 修订 4：本次运行内记住「上一张手动卡」的领域——同一份材料连续制卡时领域几乎不变（新表单自动沿用，可改） */
let lastManualDomain: string[] = [];

/** 手动制卡的提交载荷（原在 Reader.tsx，Task 4 随组件一并搬出） */
export interface ManualCardPayload {
  mode: "qa" | "reverse" | "cloze" | "imageOcclusion";
  front: string;
  back: string;
  cloze?: string;
  reversePair?: { bFront: string; bBack: string };
  imageRegion?: { dataUrl: string; alt: string; shape: OcclusionShape; rect: OcclusionRect };
  /** v49.45（D216 方案 C③）：优先级退役——字段转可选（旧调用方仍可传；制卡台不再提供入口） */
  priority?: number;
  contextPrefix?: string;
  domain?: string[];
  mnemonic?: string;
  knowledgePointId?: string;
  dateStamp?: string | null;
  /** v48.60（D101）：用户标签（表单内已 normalize；继承初值由宿主经 initialTags 预填） */
  tags?: string[];
}

/** D121 §4.1：保存前预检命中的相似已有卡（已补全答案与来源） */
interface PrecheckHit {
  id: string;
  front: string;
  back: string;
  source: string;
  score: number;
  differs: boolean;
}

/** D144 #4：ManualCardForm 的宿主句柄——幽灵接受（Alt+Enter）时把源全文写入
    第一文本框（qa/reverse/图片挖空＝正面 front，填空＝挖空文本，四态同为此值）并聚焦、光标落文末；
    v48.101（D146）：setBackValue＝「带入 AI 回答」生成链的流式落点（全量覆盖背面，逐 delta 调用）。 */
export interface ManualFormHandle {
  setFrontValue: (text: string) => void;
  setBackValue: (text: string) => void;
}

/** 手动制卡表单体（D88 §8.2 抽取，纯移动）：modal 包装之外的全部内容——
    字段、落库链（onSave → 宿主 handleManualCard）、canSave 校验一字不改。
    v48.100（D144 #4）：增 ghost / onGhostAccept（幽灵槽，仅宿主派生条件满足时传节点）/
    onFrontChange（首框值镜像上报）三可选 props；ref 句柄见 ManualFormHandle。 */
export const ManualCardForm = forwardRef<ManualFormHandle, {
  /** D123 修订 3：题型由宿主控制（题型页签在制卡台标题行里）；不传＝内部自管 */
  mode?: "qa" | "reverse" | "cloze" | "imageOcclusion";
  onModeChange?: (m: "qa" | "reverse" | "cloze" | "imageOcclusion") => void;
  /** D123 修订：「带入选区」——返回阅读区当前选区文字（无＝空） */
  onPickSelection?: () => string | null | undefined;
  /** D123 修订：「带入 AI 回答」——返回最近一条 AI 回答（无＝空） */
  onPickAnswer?: () => string | null | undefined;
  /** D123：dock＝制卡台常驻表单（隐藏「取消」、高级字段收进「更多」）；modal＝原弹窗形态 */
  variant?: "modal" | "dock";
  quote: string;
  /** v25：来自图片聚焦选区（工具条「手动制卡」）——提供时默认进入图片挖空页签 */
  imageRegion?: { dataUrl: string; alt: string; shape: OcclusionShape; rect: OcclusionRect };
  /** v48.60（D101）：标签词表建议（cards:listTags；不传则无建议下拉） */
  tagSuggestions?: TagVocabEntry[] | null;
  /** v48.60（D101）：标签初值（批注标签继承预填，可删） */
  initialTags?: string[];
  onCancel: () => void;
  /** 返回新建卡 id（宿主 handleManualCard 链；翻转对为第一张），供「保存并辨析」使用 */
  onSave: (payload: ManualCardPayload) => Promise<string | null | void>;
  /** D121 §4.1：「保存并辨析」——保存成功后以新卡为 A、相似卡为 B 打开辨析弹窗（宿主渲染，表单卸载后仍存活）；不传则不显示该按钮 */
  onDisambiguate?: (newCardId: string, otherCardId: string) => void;
  /** D144 #4：幽灵草稿层节点（宿主按 §4.2 派生条件构建；渲染进第一文本框的 field 容器） */
  ghost?: ReactNode;
  /** D144 #4：幽灵 Alt+Enter 接受回调（v48.101/D146：点击接受已退役，此为唯一接受路径） */
  onGhostAccept?: () => void;
  /** D144 #4：第一文本框值镜像上报（宿主只读用于幽灵显示条件；宿主不回写——无损红线） */
  onFrontChange?: (v: string) => void;
  /** v48.101（D146）：「带入 AI 回答」生成链——无既有回答且正面非空时触发生成（宿主流式写回背面） */
  onGenerateAnswer?: (question: string) => void;
  /** v48.101（D146）：生成进行中（pick 钮显示「生成中…」并忽略再点） */
  answerGenerating?: boolean;
}>(function ManualCardForm({
  quote,
  imageRegion,
  tagSuggestions,
  initialTags,
  onCancel,
  onSave,
  onDisambiguate,
  onPickSelection,
  onPickAnswer,
  mode: modeProp,
  onModeChange,
  variant = "modal",
  ghost,
  onGhostAccept,
  onFrontChange,
  onGenerateAnswer,
  answerGenerating
}, ref) {
  const T = useT();
  const [modeInner, setModeInner] = useState<"qa" | "reverse" | "cloze" | "imageOcclusion">(imageRegion ? "imageOcclusion" : "qa");
  const mode = modeProp ?? modeInner;
  const setMode = (m: "qa" | "reverse" | "cloze" | "imageOcclusion") => {
    setModeInner(m);
    onModeChange?.(m);
  };
  const [front, setFront] = useState(imageRegion ? "" : quote);
  const [back, setBack] = useState("");
  const [bFront, setBFront] = useState("");
  const [bBack, setBBack] = useState("");
  // v49.45（D216 方案 C③）：优先级滑杆退役，state 随之删除（payload.priority 可选，缺省落 DB 默认 50）
  const [saving, setSaving] = useState(false);
  // M5：与 AI 制卡同构的元数据字段（领域标签对齐 R17：≤2 个、首个为主）
  const [domain, setDomainRaw] = useState<string[]>(() => (variant === "dock" ? lastManualDomain : []));
  const setDomain = (v: string[]) => {
    touched.current.domain = true;
    setDomainRaw(v);
  };
  const [contextPrefix, setContextPrefix] = useState("");
  const [mnemonic, setMnemonic] = useState("");
  const [knowledgePointId, setKnowledgePointId] = useState("");
  const [dateStamped, setDateStamped] = useState(false);
  // D123 修订 4：自动填写——用户一旦手动动过某项就不再覆盖（touched 记在 ref，不触发渲染）
  const touched = useRef({ domain: false, prefix: false, date: false });
  // v48.60（D101）：标签（初值 = 批注标签继承预填，可删）；v48.63（D107）：总开关关闭时恒空提交
  const tagsEnabled = useTagsEnabled();
  const [tags, setTags] = useState<string[]>(initialTags ?? []);
  // D123：dock 变体的高级字段默认收起（DOM 保持挂载，仅 hidden——载荷与落库链不变）
  const [moreOpen, setMoreOpen] = useState(false);

  // ===== D144 #4（§4.2）：首框值镜像上报 + 幽灵接受 caret 收尾 =====
  // 四题型第一文本框同为 front state；宿主按镜像判幽灵显示条件（单向：宿主不回写——无损红线）。
  const onFrontChangeRef = useRef(onFrontChange);
  onFrontChangeRef.current = onFrontChange;
  useEffect(() => {
    onFrontChangeRef.current?.(front);
  }, [front]);
  // 接受后光标落文末（挂在 front 提交后的 layout effect，与 ClozeField pendingCaret 同手法）：
  // qa/reverse/图片挖空＝ProseMirror（Range 折叠到末尾），填空＝textarea（setSelectionRange）。
  const fieldsRef = useRef<HTMLDivElement | null>(null);
  const pendingFrontCaret = useRef(false);
  useLayoutEffect(() => {
    if (!pendingFrontCaret.current) return;
    pendingFrontCaret.current = false;
    const first = fieldsRef.current?.querySelector<HTMLElement>(".wb-field");
    if (!first) return;
    const ta = first.querySelector<HTMLTextAreaElement>("textarea");
    if (ta) {
      ta.focus({ preventScroll: true });
      ta.setSelectionRange(ta.value.length, ta.value.length);
      return;
    }
    const pm = first.querySelector<HTMLElement>(".ProseMirror");
    if (pm) {
      pm.focus({ preventScroll: true });
      const s = window.getSelection();
      if (s) {
        const range = document.createRange();
        range.selectNodeContents(pm);
        range.collapse(false);
        s.removeAllRanges();
        s.addRange(range);
      }
    }
  }, [front]);
  useImperativeHandle(
    ref,
    () => ({
      setFrontValue: (text: string) => {
        pendingFrontCaret.current = true;
        setFront(text);
      },
      // v48.101（D146）：「带入 AI 回答」生成链的流式落点——全量覆盖背面（逐 delta 调用），不动光标
      setBackValue: (text: string) => {
        setBack(text);
      }
    }),
    []
  );

  // 题型切换预填。填空题特殊：第一字段是纯文本 textarea，而问答/翻转第一字段是 MarkdownEditor
  //（Milkdown）——其序列化按 remark 规范以尾随换行收尾（输入 "x" 上报 "x\n"），textarea 会忠实
  // 渲染成一行多余空行（GrowField 随之撑高）。进入填空态时去掉尾随换行；layout 时机保证
  // textarea 首帧绘制前已归一（否则先以两行高度闪现一帧）。
  useLayoutEffect(() => {
    if (mode === "qa" || mode === "imageOcclusion") {
      setFront((f) => (f ? f : ""));
    } else if (mode === "cloze") {
      // D123：无引用文本时保留用户已写的正面（常驻表单里切题型不应清空输入）
      setFront((f) => (quote ? quote : f).replace(/[\r\n]+$/, ""));
    } else {
      setFront((f) => (quote ? quote : f));
    }
  }, [mode, quote]);
  // D123：制卡台表单常驻——引用文本后到（选区「制卡」）时只在正面为空/仍是上一份引用时预填，不覆盖用户已写内容
  const prevQuoteRef = useRef(quote);
  useEffect(() => {
    if (quote === prevQuoteRef.current) return;
    const prev = prevQuoteRef.current;
    prevQuoteRef.current = quote;
    setFront((f) => (!f || f === prev ? quote : f));
  }, [quote]);

  // D123 修订 4：自动填写（仅 dock 形态；用户动过的项不再覆盖）
  //  · 标注日期：正反面命中「统计/版本/价格/政策/截至/目前/当前/最新」（与 L12 lint 同一正则）→ 自动勾选，不命中 → 取消
  //  · 前缀：已选领域且前缀为空 → 取首个领域的名称（规则16：只能写领域/学科名）
  //  · 领域：沿用上一张手动卡的领域（初值，见 lastManualDomain）
  useEffect(() => {
    if (variant !== "dock" || touched.current.date) return;
    setDateStamped(needsDateStamp(`${front}\n${back}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [front, back]);
  useEffect(() => {
    if (variant !== "dock" || touched.current.prefix) return;
    setContextPrefix(domain.length ? `${udcLabel(domain[0])}:` : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain]);

  // D88 §4.3：主 CTA「创建卡片」涟漪（填充钮白名单成员；真实 pointerdown 驱动，reduce 不挂）
  const createBtnRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const el = createBtnRef.current;
    if (!el) return;
    return attachRipple(el);
  }, []);

  // D121 §4.1：保存前相似卡预检——面板只出现一次（front 文本变化后再保存才重新检索）
  const [hits, setHits] = useState<PrecheckHit[] | null>(null);
  const [checking, setChecking] = useState(false);
  const lastChecked = useRef<string | null>(null);
  const precheckText = manualPrecheckText(mode, front, mode === "cloze" ? toCloze(front) : null);
  useEffect(() => {
    // 面板展开后用户改了 front：面板作废（下次保存重新检索）
    if (hits && precheckText !== lastChecked.current) setHits(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [precheckText]);

  async function onCreateClick() {
    if (shouldRunPrecheck(precheckText, lastChecked.current)) {
      setChecking(true);
      try {
        const found = await similaritySearch.findSimilar(precheckText as string, PRECHECK_K);
        lastChecked.current = precheckText;
        const list: PrecheckHit[] = [];
        for (const f of found) {
          const c = (await cardsApi.get(f.cardId).catch(() => null)) as (Awaited<ReturnType<typeof cardsApi.get>> & { docTitle?: string; isDeleted?: boolean }) | null;
          if (!c || c.isDeleted) continue;
          const title = c.sourceRef?.title || c.docTitle || "";
          const author = c.sourceRef?.author ? ` · ${c.sourceRef.author}` : "";
          const otherBack = c.backMarkdown ?? "";
          list.push({
            id: c.id,
            front: c.frontMarkdown || c.noteText || f.front || "",
            back: otherBack,
            source: title ? `《${title}》${author}` : T("来源未知"),
            score: f.score,
            differs: answerDiffers(back, otherBack, bigramJaccard(back, otherBack))
          });
        }
        if (list.length > 0) {
          setHits(list);
          return;
        }
      } catch {
        // 检索失败不阻塞制卡：走原保存路径
      } finally {
        setChecking(false);
      }
    }
    await save();
  }

  async function save(disambiguateWith?: string) {
    setSaving(true);
    const meta = {
      // v49.45（D216 方案 C③）：priority 不再提交——payload 可选，DB 默认 50（调度不读该字段）
      contextPrefix: contextPrefix.trim(),
      domain,
      mnemonic: mnemonic.trim(),
      knowledgePointId: knowledgePointId.trim(),
      // 日期标记（R11/规则19）：易变内容勾选后写入当日日期
      dateStamp: dateStamped ? new Date().toISOString().slice(0, 10) : null,
      tags: tagsEnabled ? tags : []
    };
    const clozeText = mode === "cloze" ? toCloze(front) : undefined;
    if (variant === "dock") lastManualDomain = domain;
    setHits(null);
    const newId = await onSave({
      mode,
      front: mode === "cloze" ? clozeText ?? "" : front,
      back,
      cloze: clozeText,
      reversePair:
        mode === "reverse"
          ? { bFront: bFront.trim() || back, bBack: bBack.trim() || front }
          : undefined,
      imageRegion: mode === "imageOcclusion" ? imageRegion : undefined,
      ...meta
    });
    setSaving(false);
    if (disambiguateWith && newId) onDisambiguate?.(newId, disambiguateWith);
  }

  function toCloze(text: string): string {
    // 简易挖空：用户用 **粗体** 或〔〕标记答案，否则保持原文
    const bold = /\*\*(.+?)\*\*/.exec(text);
    if (bold) return text.replace(bold[0], `{{c1::${bold[1]}}}`);
    const bracket = /〔(.+?)〕/.exec(text);
    if (bracket) return text.replace(bracket[0], `{{c1::${bracket[1]}}}`);
    return text;
  }

  const canSave =
    mode === "imageOcclusion"
      ? Boolean(imageRegion) && Boolean(back.trim())
      : mode === "qa" || mode === "reverse"
        ? Boolean(front.trim()) && Boolean(back.trim())
        : parseCloze(toCloze(front)).ords.length > 0;

  // D121 §4.1：相似已有卡预检面板（内联、不弹窗；每个 front 文本只出现一次）；modal / dock 两种形态共用
  const hitsPanel =
    hits && hits.length > 0 ? (
          <div className="manual-similar" data-testid="manual-similar-panel" role="region" aria-label={T("相似已有卡")}>
            <p className="manual-similar-title">{T("发现 {n} 张相似已有卡——确认不是重复或矛盾后再保存", { n: hits.length })}</p>
            <ul className="manual-similar-list">
              {hits.map((h) => (
                <li key={h.id} className="manual-similar-item" data-testid="manual-similar-item">
                  <div className="disamb-candidate-q">{clipText(h.front, 80)}</div>
                  <div className="disamb-candidate-a">{T("答：")}{clipText(h.back, 60) || T("（无）")}</div>
                  <div className="disamb-candidate-meta">
                    <span>{h.source}</span>
                    <span className="mono">{T("相似 {n}%", { n: Math.round(h.score * 100) })}</span>
                    {h.differs && <span className="disamb-tag">{T("答案不同")}</span>}
                    {onDisambiguate && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm manual-similar-disamb"
                        disabled={saving}
                        onClick={() => void save(h.id)}
                      >
                        {T("保存并辨析")}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <div className="manual-similar-actions">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setHits(null)}>{T("返回修改")}</button>
              <button type="button" className="btn btn-secondary btn-sm" disabled={saving} onClick={() => void save()}>{T("仍然保存")}</button>
            </div>
          </div>
        
    ) : null;

  // D123 修订（用户 2026-10-10，还原 制卡台-融合优化版-v3.html）：dock 形态只留「引用 · 题型 · 正面/背面框 ·
  // 页脚（更多 / 制卡）」，说明性长文案收进 title / placeholder；高级字段收进「更多」（hidden 不卸载，载荷不变）。
  if (variant === "dock") {
    const pickSel = onPickSelection ? { label: T("带入选区"), empty: T("没有选区"), get: onPickSelection, apply: setFront } : undefined;
    // v48.101（D146）：「带入 AI 回答」三态——①有既有回答＝带入；②无既有回答但正面非空且宿主给了
    // 生成链（问答/翻转；图片挖空的答案来自图内容，不接生成）＝触发生成并流式写回背面；③正面为空＝
    // 「暂无 AI 回答」空态提示（1.4s 自复）。
    const canGenerate = (mode === "qa" || mode === "reverse") && !!front.trim() && !!onGenerateAnswer;
    const pickAns = onPickAnswer
      ? {
          label: T("带入 AI 回答"),
          empty: T("暂无 AI 回答"),
          get: onPickAnswer,
          apply: setBack,
          generate: canGenerate ? () => onGenerateAnswer?.(front.trim()) : undefined,
          busy: answerGenerating
        }
      : undefined;
    return (
      <>
        <div
          className="wb-fields"
          ref={fieldsRef}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !isImeComposing(e) && canSave && !saving && !checking) {
              e.preventDefault();
              void onCreateClick();
            }
          }}
        >
          {mode === "reverse" ? (
            <>
              <GrowField ghost={ghost} onGhostAccept={onGhostAccept} pick={front.trim() ? undefined : pickSel}><MdField minRows={1} value={front} onChange={setFront} placeholder={T("问题（制卡后另生成一张：以它为答案）")} label={T("问题")} /></GrowField>
              <GrowField pick={back.trim() ? undefined : pickAns}><MdField minRows={1} value={back} onChange={setBack} placeholder={T("答案（制卡后另生成一张：以它为问题）")} label={T("答案")} /></GrowField>
            </>
          ) : mode === "qa" ? (
            <>
              <GrowField ghost={ghost} onGhostAccept={onGhostAccept} pick={front.trim() ? undefined : pickSel}><MdField minRows={1} value={front} onChange={setFront} placeholder={T("正面（问题）")} label={T("题面")} /></GrowField>
              <GrowField pick={back.trim() ? undefined : pickAns}><MdField minRows={1} value={back} onChange={setBack} placeholder={T("背面（答案）")} label={T("答案")} /></GrowField>
            </>
          ) : mode === "cloze" ? (
            <ClozeField value={front} onChange={setFront} ghost={ghost} onGhostAccept={onGhostAccept} onPick={onPickSelection && !front.trim() ? { label: T("带入选区"), get: onPickSelection } : undefined} />
          ) : imageRegion ? (
            <>
              <div className="occlusion-stage occlusion-preview manual-region-preview">
                <img src={imageRegion.dataUrl} alt="" className="occlusion-img" />
                <OcclusionShapes occlusion={{ shapes: [imageRegion.shape] }} cardOrd={0} />
              </div>
              <GrowField><MdField minRows={1} value={front} onChange={setFront} placeholder={T("正面（默认「图中遮挡区域对应的是什么？」）")} label={T("正面（图片挖空）")} /></GrowField>
              <GrowField pick={back.trim() ? undefined : pickAns}><MdField minRows={1} value={back} onChange={setBack} placeholder={T("背面（答案，必填）")} label={T("背面（图片挖空）")} /></GrowField>
            </>
          ) : (
            <p className="wb-empty">{T("点上方「图片挖空」开始截图")}</p>
          )}
        </div>

        {hitsPanel}

        {/* 「更多」：collapse-clip 通用折叠（grid-template-rows 0fr↔1fr，--dur-panel + --ease-out-soft；收起态 visibility 延后隐藏，防 Tab 进入） */}
        <div className={`collapse-clip wb-more-clip${moreOpen ? " is-open" : ""}`} data-testid="manual-more" aria-hidden={!moreOpen}>
          <div className="collapse-inner">
            <div className="wb-more">
              <div className="wb-row" title={T("对齐 R17：UDC 受控清单，≤2 个，首个为主领域")}>
                <span className="wb-k">{T("领域")}</span>
                <div className="wb-v"><UdcPicker value={domain} onChange={setDomain} /></div>
              </div>
              {tagsEnabled && (
                <div className="wb-row" title={T("自由组织词汇，用 :: 分层级，如「考研::英语」")}>
                  <span className="wb-k">{T("标签")}</span>
                  <div className="wb-v"><TagInput value={tags} onChange={setTags} suggestions={tagSuggestions ?? null} ariaLabel={T("标签")} /></div>
                </div>
              )}
              <label className="wb-row" title={T("只能写领域/学科名，禁止泄漏答案（规则 16）")}>
                <span className="wb-k">{T("前缀")}</span>
                <input className="wb-line" type="text" value={contextPrefix} onChange={(e) => { touched.current.prefix = true; setContextPrefix(e.target.value); }} placeholder={T("自动：取领域名称")} />
              </label>
              <label className="wb-row" title={T("规则 7：克制使用")}>
                <span className="wb-k">{T("助记")}</span>
                <input className="wb-line" type="text" value={mnemonic} onChange={(e) => setMnemonic(e.target.value)} placeholder={T("例：中位数的「中」＝正中间")} />
              </label>
              <label className="wb-row" title={T("同组卡片共享同一 knowledgePointId")}>
                <span className="wb-k">{T("知识点")}</span>
                <input className="wb-line" type="text" value={knowledgePointId} onChange={(e) => setKnowledgePointId(e.target.value)} placeholder={T("例：kp-中位数")} />
              </label>
              <label className="wb-row wb-check" title={T("规则 19：统计数字 / 版本 / 价格等易变内容勾选，写入今日日期")}>
                <input type="checkbox" checked={dateStamped} onChange={(e) => { touched.current.date = true; setDateStamped(e.target.checked); }} />
                <span>{T("标注日期")}</span>
              </label>
            </div>
          </div>
        </div>

        <div className="form-actions wb-foot">
          <button type="button" className="wb-more-toggle" data-testid="manual-more-toggle" aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)}>
            {T("更多")}
            <IconChevronDown size={12} className={moreOpen ? "is-flip" : undefined} />
          </button>
          <button
            ref={createBtnRef}
            className="btn btn-primary"
            disabled={saving || checking || !canSave}
            title="Ctrl+Enter"
            onClick={(e) => {
              settle(e.currentTarget);
              void onCreateClick();
            }}
          >
            {saving ? T("保存中…") : checking ? T("检查中…") : T("制卡")}
          </button>
        </div>
      </>
    );
  }

  return (
    <>
    {quote && <blockquote className="card-quote card-marked">{quote}</blockquote>}

        <div className="seg-tabs">
          <button className={mode === "qa" ? "active" : ""} onClick={() => setMode("qa")}>
            {T("问答题")}
          </button>
          <button className={mode === "reverse" ? "active" : ""} onClick={() => setMode("reverse")}>
            {T("翻转问答")}
          </button>
          <button className={mode === "cloze" ? "active" : ""} onClick={() => setMode("cloze")}>
            {T("填空题")}
          </button>
          <button className={mode === "imageOcclusion" ? "active" : ""} onClick={() => setMode("imageOcclusion")}>
            {T("图片挖空")}
          </button>
        </div>

        {mode === "reverse" ? (
          <>
            <p className="form-hint">{T("翻转问答：一次性创建两张互为翻转的独立问答卡（B 面留空则自动正反互换），各自有独立的复习调度。")}</p>
            <div className="form-field">
              <label>{T("A 面 · 题面（建议「领域前缀: 问题」）")}</label>
              <MdField value={front} onChange={setFront} placeholder={T("例：统计: 中位数是什么？")} label={T("题面")} />
            </div>
            <div className="form-field">
              <label>{T("A 面 · 答案（目标 ≤15 字）")}</label>
              <MdField value={back} onChange={setBack} placeholder={T("例：排序后位于中间位置的数")} label={T("答案")} />
            </div>
            <div className="form-field">
              <label>{T("B 面 · 题面（留空则自动用 A 面答案反向提问）")}</label>
              <MdField value={bFront} onChange={setBFront} placeholder={T("例：统计: 排序后位于中间位置的数叫什么？")} label={T("B 面 · 题面")} />
            </div>
            <div className="form-field">
              <label>{T("B 面 · 答案（留空则自动用 A 面题面）")}</label>
              <MdField value={bBack} onChange={setBBack} placeholder={T("例：中位数")} label={T("B 面 · 答案")} />
            </div>
          </>
        ) : mode === "qa" ? (
          <>
            <div className="form-field">
              <label>{T("正面（问题，建议「领域前缀: 问题」）")}</label>
              <MdField value={front} onChange={setFront} placeholder={T("例：统计: 中位数是什么？")} label={T("题面")} />
            </div>
            <div className="form-field">
              <label>{T("背面（答案，目标 ≤15 字）")}</label>
              <MdField value={back} onChange={setBack} placeholder={T("例：排序后位于中间位置的数")} label={T("答案")} />
            </div>
          </>
        ) : mode === "cloze" ? (
          <div className="form-field">
            <label>
              {T("挖空文本（用 **双星号** 或〔括号〕包住答案，自动转 Anki 挖空；多挖空用 c1/c2 编号语法）")}
            </label>
            <MdField value={front} onChange={setFront} label={T("挖空文本")} />
            <p className="form-preview mono">{front.replace(/\*\*(.+?)\*\*/g, "〔$1〕")}</p>
          </div>
        ) : (
          <>
            <p className="form-hint">
              {T("图片挖空：正面按所选区域遮挡，答案面显示原图与答案文本。区域来自阅读器中的图片选区。")}
            </p>
            {imageRegion ? (
              <>
                <div className="occlusion-stage occlusion-preview manual-region-preview">
                  <img src={imageRegion.dataUrl} alt="" className="occlusion-img" />
                  <OcclusionShapes occlusion={{ shapes: [imageRegion.shape] }} cardOrd={0} />
                </div>
                <div className="form-field">
                  <label>{T("正面（问题，默认「图中遮挡区域对应的是什么？」）")}</label>
                  <MdField value={front} onChange={setFront} placeholder={T("图中遮挡区域对应的是什么？")} label={T("正面（图片挖空）")} />
                </div>
                <div className="form-field">
                  <label>{T("背面（答案，必填）")}</label>
                  <MdField value={back} onChange={setBack} placeholder={T("例：海马体")} label={T("背面（图片挖空）")} />
                </div>
              </>
            ) : (
              <p className="form-hint">
                {T("尚未选择图片区域：请关闭本窗口，点击阅读材料中的图片进入聚焦，用工具条框选区域后选择「手动制卡」。")}
              </p>
            )}
          </>
        )}

        {/* M5：与 AI 制卡同构的元数据（领域标签 / 上下文前缀 / 助记 / 知识点分组 / 日期标记）
            D123：dock 变体收进「更多选项」（hidden 不卸载） */}
        <div className="form-more" data-testid="manual-more" hidden={false}>
        <div className="form-field">
          <label>{T("领域标签（对齐 R17：UDC 受控清单，≤2 个、首个为主领域）")}</label>
          <UdcPicker value={domain} onChange={setDomain} />
        </div>
        {/* v48.60（D101）：用户标签——回车/逗号/顿号确认 chip；词表建议；继承初值可删；
            v48.63（D107）：总开关关闭时整行不渲染，tags 恒空提交（继承初值一并失效） */}
        {tagsEnabled && (
          <div className="form-field">
            <label>{T("标签（可选；自由组织词汇，用 :: 分层级，如「考研::英语」）")}</label>
            <TagInput value={tags} onChange={setTags} suggestions={tagSuggestions ?? null} ariaLabel={T("标签")} />
          </div>
        )}
        <div className="form-field">
          <label>{T("上下文前缀（可选；只能写领域/学科名，禁止泄漏答案——规则16）")}</label>
          <input
            type="text"
            value={contextPrefix}
            onChange={(e) => setContextPrefix(e.target.value)}
            placeholder={T("例：统计:")}
          />
        </div>
        <div className="form-field">
          <label>{T("助记（可选，规则7 克制使用）")}</label>
          <input type="text" value={mnemonic} onChange={(e) => setMnemonic(e.target.value)} placeholder={T("例：中位数的「中」= 位置在正中间")} />
        </div>
        <div className="form-field">
          <label>{T("知识点分组（可选；同组卡片共享同一 knowledgePointId）")}</label>
          <input
            type="text"
            value={knowledgePointId}
            onChange={(e) => setKnowledgePointId(e.target.value)}
            placeholder={T("例：kp-中位数")}
          />
        </div>
        <div className="form-field form-check">
          <label className="backup-checkline">
            <input type="checkbox" checked={dateStamped} onChange={(e) => setDateStamped(e.target.checked)} />
            {T("标注日期（规则19：统计数字/版本/价格等易变内容勾选，写入今日日期）")}
          </label>
        </div>
        {/* v49.45（D216 方案 C③）：优先级滑杆退役——闪卡调度全由 FSRS 驱动，priority 不再是用户可设概念 */}
        </div>

        {hitsPanel}

        <div className="form-actions">
          <button className="btn btn-secondary" onClick={onCancel}>{T("取消")}</button>
          <button
            ref={createBtnRef}
            className="btn btn-primary"
            disabled={saving || checking || !canSave}
            onClick={(e) => {
              // D88 §4.2：settle 回弹＝真实点击主 CTA 的按压反馈（Exaggeration；animationend 自摘）
              settle(e.currentTarget);
              void onCreateClick();
            }}
          >
            {saving ? T("保存中…") : checking ? T("检查相似卡…") : T("创建卡片")}
          </button>
        </div>
    </>
  );
});

/** modal 包装（D88 §8.2 保留形态）：图片挖空继续走 modal——大图预览需要幅面（§8.2）。
    Esc/焦点锁/焦点归还仍由 useDialogA11y 承担（与抽表前一致）。 */
export default function ManualCardEditor({
  quote,
  imageRegion,
  tagSuggestions,
  initialTags,
  onCancel,
  onSave
}: {
  quote: string;
  imageRegion?: { dataUrl: string; alt: string; shape: OcclusionShape; rect: OcclusionRect };
  tagSuggestions?: TagVocabEntry[] | null;
  initialTags?: string[];
  onCancel: () => void;
  onSave: (payload: ManualCardPayload) => Promise<string | null | void>;
}) {
  const T = useT();
  const panelRef = useDialogA11y<HTMLDivElement>(onCancel);
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-panel" ref={panelRef} role="dialog" aria-modal="true" aria-label={T("手动制卡")} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{T("手动制卡")}</h2>
          <button className="icon-btn modal-close" title={T("关闭")} onClick={onCancel}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
        <div className="modal-scroll">
          <ManualCardForm quote={quote} imageRegion={imageRegion} tagSuggestions={tagSuggestions} initialTags={initialTags} onCancel={onCancel} onSave={onSave} />
        </div>
      </div>
    </div>
  );
}

/** UDC 领域多选（M5/R17）：选中的标签以 chip 展示（点击移除），菜单只列受控清单。
 *  v48.106（D151）：①菜单项只显领域名（UDC 分类号退役，与 chip 的 udcLabel 同口径——用户实测
 *  「领域名前不应带数字」）；②菜单 createPortal 到 body + fixed 定位——「更多」折叠区
 *  .collapse-inner 的 overflow:hidden（grid 0fr↔1fr 收合所需）会把 absolute 菜单盒拦腰裁掉
 *  （超出折叠区下缘的部分永久不可见，菜单内滚到底也救不回，用户实测「滚不动了文字还是显示不全」），
 *  portal 是唯一彻底逃逸；贴窗口底放不下翻向上；宿主滚动即收起（fixed 菜单不随锚点移动）。 */
function UdcPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const T = useT();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; minWidth: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    // fixed 菜单不随滚动移动：任何宿主滚动（capture 捕获坞内滚动容器）直接收起，防菜单悬空脱锚
    const onScroll = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);
  function toggle() {
    if (!open) {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      const GAP = 4; // 与 .dd-menu top: calc(100% + 4px) 同值
      const MENU_H = 240; // .udc-menu max-height；受控清单 25 项恒超限 ⇒ 实际渲染高度恒 = 240
      const flipUp = r.bottom + GAP + MENU_H > window.innerHeight;
      setPos({
        top: flipUp ? Math.max(GAP, r.top - GAP - MENU_H) : r.bottom + GAP,
        left: r.left,
        minWidth: r.width
      });
    }
    setOpen((o) => !o);
  }
  const options = [...UDC_LEAVES.map((l) => ({ code: l.code, label: l.label })), { code: UDC_OTHER, label: T("其他") }];
  return (
    <div className="udc-picker" ref={ref}>
      {value.length > 0 && (
        <div className="udc-chips">
          {value.map((code, i) => (
            <button
              key={code}
              type="button"
              className="udc-chip"
              title={i === 0 ? T("主领域（点击移除）") : T("点击移除")}
              onClick={() => onChange(value.filter((c) => c !== code))}
            >
              {udcLabel(code)}
              {i === 0 && <span className="udc-chip-main mono">{T("主")}</span>}
              <IconClose size={12} />
            </button>
          ))}
        </div>
      )}
      {value.length < UDC_MAX && (
        <div className="dd">
          <button ref={btnRef} type="button" className="dd-btn" onClick={toggle}>
            {value.length === 0 ? T("选择领域") : T("再加一个领域")}
            <IconChevronDown size={12} className="dd-caret" />
          </button>
          {open && pos && createPortal(
            <div
              className="dd-menu dd-menu-left udc-menu"
              role="listbox"
              ref={menuRef}
              style={{ position: "fixed", top: pos.top, left: pos.left, right: "auto", minWidth: pos.minWidth }}
            >
              {options.map((o) => (
                <button
                  key={o.code}
                  type="button"
                  role="option"
                  aria-selected={value.includes(o.code)}
                  className="dd-item"
                  disabled={value.includes(o.code)}
                  onClick={() => {
                    onChange([...value, o.code]);
                    setOpen(false);
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>,
            document.body
          )}
        </div>
      )}
    </div>
  );
}
