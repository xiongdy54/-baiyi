// 选区动作的面板编排（手动制卡 / 查词 / AI）——批 4 Task 10 从 Reader.tsx 原样搬出，
// 摘录页、阅读器与自由宿主（其余页面 / 独立窗口）共用同一份渲染（§4 纪律：宿主不得保留实现副本）。
// 本组件只做「把 useSelectionActions 的状态与回调接到既有面板上」，不含业务逻辑。
// v48.79（D123）：学习坞升级为「制卡台」——手动制卡表单**常驻**（可收成仅标题行，草稿保留），
// AI 区为页签（解释｜制卡）；入口只有顶栏按钮 / Ctrl+K（经 wb:toggle 事件开合），不再有坞内关闭钮与把手。
// 页签体隐藏保活（display:none 不卸载：流式继续、表单草稿不丢）；词典面板/图片挖空 modal 维持独立弹窗不入坞。
// v48.100（D144 #2）：IA 重设计——制卡板块（「手动制卡｜AI 制卡」双页签，默认手动，两体常驻保活）+
// 解释板块（恒在坞底、默认收起；把手/内容槽/按钮行槽/composer 槽由 CardDock 承载，编排在本组件）。
// v48.100（D144 #3）：解释板块功能落地——悬浮按钮行＝ExplainModeBar 四 ghost 钮（§4.3 语义矩阵在
// selectExplainMode）；composer 值受控 + ref 句柄（#5「引用」头部插入落点）；自动展开通道在
// useSelectionActions（runExplain/runAsk/内容派生），把手开收不打断在途流式；解释空态 FreeSource
// 实例按 §10 退役（解释入口唯一归口＝底部输入条）。
// v48.100（D144 #4）：跨页签幽灵草稿同步（§4.2）——AI 侧源＝FreeSource 材料框文本（受控上提，
// §6）；手动侧源＝ManualCardForm 首框值镜像（onFrontChange，宿主只读）+ ManualFormHandle 写入；
// 幽灵派生/接受（Alt+Enter 坞内固定键 + 点击）/消失全在本组件；无损红线＝接受只写目标框。
import ManualCardEditor, { ManualCardForm, type ManualFormHandle } from "./ManualCardEditor";
import CardDock, { type CardsTab } from "./CardDock";
import AIPanel, { ChatComposer, ExplainModeBar, ExplainThread, type ChatComposerHandle, type ExplainComposerMode } from "./AIPanel";
// D144 #5（§4.4）：坞内三按钮选单（解释内容区选区触发）+ 其定位锚类型（placePopover 视口坐标）
import { DockTrioMenu } from "./DockTrioMenu";
import type { PopoverRect } from "../lib/popoverPlace";
import { DictPanel } from "./DictPanel";
import OcclusionEditor from "./editor/OcclusionEditor";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { growTextarea } from "../lib/autoGrow";
import { cardsApi, type CardDraft, type CardRecord } from "../lib/cards";
import DisambiguateModal from "./DisambiguateModal";
import type { TagVocabEntry } from "../lib/tags";
import type { DictionaryEntry, ReadingContext, VocabKind } from "../lib/dict";
import type { SelectionActions } from "../lib/useSelectionActions";
import {
  WB_TOGGLE_EVENT,
  getLastWorkbenchOpen,
  publishWorkbenchState,
  setLastWorkbenchOpen,
  useWorkbenchPlacement,
  type WorkbenchDockPlacement
} from "../lib/workbenchLayout";

/** D144 §3.3/§8：幽灵草稿层——覆盖目标输入面的定位层（宿主 CSS：field 容器 relative 内 absolute 铺满）。
 *  文本＝源全文（样式仅 3 行截断，接受时写全文——§4.2）；尾部 chip「Alt+Enter 填入」；整层可点＝接受；
 *  data-accept-key＝§10 DOM 契约。出现＝挂载后 rAF 翻 .is-in 触发 opacity 0→1 淡入（--dur-enter/
 *  --ease-enter，no-preference 作用域）；消失瞬时＝条件脱落直接卸载（§8，无出场动画）。 */
function GhostLayer({ text, onAccept }: { text: string; onAccept: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const raf = window.requestAnimationFrame(() => el.classList.add("is-in"));
    return () => window.cancelAnimationFrame(raf);
  }, []);
  return (
    <div ref={ref} className="wb-ghost" data-accept-key="Alt+Enter" title="点击填入" onClick={onAccept} aria-hidden="true">
      <span className="wb-ghost-text">{text}</span>
      <span className="wb-ghost-chip mono">Alt+Enter 填入</span>
    </div>
  );
}

/** 无选区/无面板时的自由材料输入：粘贴或输入一段文字 → AI 解释 / AI 制卡（自由模式与独立窗口的主入口）。
 *  v48.100（D144 #4）：文本受控上提到 SelectionPanels（§6，幽灵同步的 AI 侧源）；幽灵层挂输入面
 *  （仅手动侧为源时在场），接受＝宿主写目标框（无损红线），本组件只负责 caret 收尾（光标落文末）。 */
function FreeSource({
  text,
  onTextChange,
  ghostText,
  onGhostAccept,
  onExplain,
  onCards,
  prefer
}: {
  text: string;
  onTextChange: (v: string) => void;
  /** D144 §4.2：幽灵文本（源＝手动首框）；不传＝无幽灵 */
  ghostText?: string;
  /** 幽灵接受回调（宿主把源全文写入手动首框） */
  onGhostAccept?: () => void;
  onExplain: (t: string) => void;
  onCards: (t: string) => void;
  prefer: "explain" | "cards";
}) {
  const t = text.trim();
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const caretEndPending = useRef(false);
  useLayoutEffect(() => {
    if (ref.current) growTextarea(ref.current, 168);
    if (caretEndPending.current && ref.current) {
      caretEndPending.current = false;
      ref.current.focus({ preventScroll: true });
      ref.current.setSelectionRange(ref.current.value.length, ref.current.value.length);
    }
  }, [text]);
  const acceptGhost = () => {
    if (!onGhostAccept) return;
    caretEndPending.current = true;
    onGhostAccept();
  };
  return (
    <div className="wb-free" data-testid="wb-free-source">
      {/* relative 包裹层：幽灵层与 textarea 同几何（§3.3）；Alt+Enter＝坞内固定键（D123 §1-11
          Ctrl+K 同例，不经 CommandRegistry），目标输入面聚焦时接受；与 Ctrl+Enter（发送）/
          Shift+Enter（换行）/IME 组合态无冲突 */}
      <div
        className="wb-free-input"
        onKeyDown={(e) => {
          if (ghostText && e.altKey && e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            acceptGhost();
          }
        }}
      >
        <textarea
          ref={ref}
          value={text}
          placeholder="粘贴或输入要处理的文字"
          aria-label="待处理文字"
          rows={1}
          onChange={(e) => onTextChange(e.target.value)}
        />
        {ghostText && onGhostAccept && <GhostLayer text={ghostText} onAccept={acceptGhost} />}
      </div>
      {/* 有内容才出现，高度随之展开（collapse-clip）；空态一行即止 */}
      <div className={`collapse-clip wb-free-clip${t ? " is-open" : ""}`}>
        <div className="collapse-inner">
          <div className="wb-free-acts">
            <button type="button" className={`btn btn-sm ${prefer === "explain" ? "btn-primary" : "btn-outline"}`} disabled={!t} onClick={() => onExplain(t)}>
              AI 解释
            </button>
            <button type="button" className={`btn btn-sm ${prefer === "cards" ? "btn-primary" : "btn-outline"}`} disabled={!t} onClick={() => onCards(t)}>
              AI 制卡
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SelectionPanels({
  sel,
  dockMeta,
  placementOverride
}: {
  /** useSelectionActions 的返回值（原样传入；类型即钩子返回值，不另立影子类型） */
  sel: SelectionActions;
  /** 手动区标题行 meta（材料名，有则显，无则省） */
  dockMeta?: string;
  /** 独立窗口传 "window"：制卡台占满窗口，不推让不外延，且常开 */
  placementOverride?: "window";
  /** @deprecated D123：保留以兼容旧宿主调用，已不使用（AIPanel 自算计时） */
  selectionText?: string | null;
  nowTick?: number;
  elapsedSec?: number;
}) {
  const { aiPanel, manualOpen, manualImage, manualQuote, dictPanel, dockOpen } = sel;
  const settingPlacement = useWorkbenchPlacement();
  const placement: WorkbenchDockPlacement = placementOverride ?? settingPlacement;
  // v48.60（D101）：标签词表建议（cards.tags_json ∪ extracts.tag_json 派生；建卡/卡片改动后刷新）
  const [tagVocab, setTagVocab] = useState<TagVocabEntry[]>([]);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      window.cardsAPI?.listTags?.().then((list) => {
        if (!cancelled) setTagVocab(list ?? []);
      });
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [sel.manualSeq, sel.dockOpen]);

  const [manualCollapsed, setManualCollapsed] = useState(false);
  // D144 #2：制卡板块页签（默认「手动制卡」，用户拍板）；解释板块开态在 hook（sel.explainOpen，
  // D144 #3 通道：runExplain/runAsk/内容派生自动展开；把手开合＝纯 state，不打断在途流式）
  const [cardsTab, setCardsTab] = useState<CardsTab>("manual");
  // D144 #3：解释板块「当前方式」（四值 §4.3；三解读方式的会话内记忆＝hook explainMode）与
  // composer 受控值（「引用」头部插入的数据面，#5 选单落点）
  const [composerMode, setComposerMode] = useState<ExplainComposerMode>("auto");
  const [composerText, setComposerText] = useState("");
  const composerRef = useRef<ChatComposerHandle | null>(null);
  // 内容派生桥接（D144 §2.1）：AI 制卡内容到达（kind 变化或同 kind 重跑，与 hook 派生同口径）→
  // 制卡板块自动切「AI 制卡」页签；解释内容到达→解释板块自动展开在 hook runExplain/runAsk 入口（#3）。
  // 显式点击只改 cardsTab（changeCardsTab）。
  useEffect(() => {
    if (aiPanel && (aiPanel.kind === "cards" || aiPanel.kind === "occlusion")) setCardsTab("aicards");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiPanel?.kind, aiPanel?.startedAt]);
  const dockRootRef = useRef<HTMLDivElement | null>(null);

  /** 把焦点交给手动表单的第一个可输入字段（点开即可打字，D88 §15 注记延续） */
  const focusManual = () => {
    // 修订 9：① 等滑入动画结束（制卡台此刻仍在屏幕外 translateX，聚焦屏外元素会让浏览器去滚动
    // overflow:hidden 的祖先把它「滚进视野」——顶栏随之整体平移，随后弹回）；② preventScroll 双保险；
    // ③ 聚焦后把可能被带偏的祖先滚动位置归零。
    window.setTimeout(() => {
      const root = document.querySelector('[data-testid="wb-cards"]');
      const first = root?.querySelector('textarea, input:not([type=checkbox]):not([type=range]), [contenteditable="true"]');
      (first as HTMLElement | null)?.focus({ preventScroll: true });
      for (const el of [document.documentElement, document.body, document.querySelector<HTMLElement>(".app-shell")]) {
        if (el && (el.scrollLeft || el.scrollTop)) {
          el.scrollLeft = 0;
          el.scrollTop = 0;
        }
      }
    }, 300);
  };

  // 顶栏按钮 / Ctrl+K → 开合制卡台（每个页面恰有一个宿主挂着本组件）
  const toggleRef = useRef<() => void>(() => {});
  toggleRef.current = () => {
    if (placementOverride === "window") return;
    if (!sel.dockEverOpened || !sel.dockOpen) {
      setManualCollapsed(false);
      setCardsTab("manual"); // D144：唤坞回到默认「手动制卡」页签（点开即可打字）
      sel.expandDock();
      focusManual();
    } else {
      sel.collapseDock();
    }
  };
  useEffect(() => {
    const on = () => toggleRef.current();
    window.addEventListener(WB_TOGGLE_EVENT, on);
    return () => window.removeEventListener(WB_TOGGLE_EVENT, on);
  }, []);

  // 工具栏/浮条「制卡」（actions.manual）唤坞时：手动制卡页签展开并聚焦
  useEffect(() => {
    if (sel.manualOpen && !sel.manualImage) {
      setManualCollapsed(false);
      setCardsTab("manual");
      focusManual();
    }
  }, [sel.manualOpen, sel.manualImage]);

  // 独立窗口：常开；主窗口：切换页面后沿用「开着」的状态（宿主随视图换，见 workbenchLayout.lastOpen）
  const initialOpenRef = useRef(getLastWorkbenchOpen());
  useEffect(() => {
    if (placementOverride === "window" || initialOpenRef.current) sel.expandDock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placementOverride]);

  // 向顶栏按钮同步状态（静态方块点：AI 在跑 / 无动画）
  const threadBusy = sel.thread.some((x) => x.running);
  const busy = !!aiPanel?.running || threadBusy;
  const isOpen = sel.dockEverOpened && dockOpen;
  useEffect(() => {
    if (placementOverride === "window") return;
    publishWorkbenchState({ open: isOpen, busy, draft: false });
    // 只在「本宿主已挂载过且稳定」后记录，避免新宿主首帧（尚未按 lastOpen 展开）把标记冲掉
    if (isOpen || sel.dockEverOpened) setLastWorkbenchOpen(isOpen);
  }, [isOpen, busy, placementOverride]);
  useEffect(() => {
    if (placementOverride === "window") return;
    return () => publishWorkbenchState({ open: false, busy: false, draft: false });
  }, [placementOverride]);

  /** 手动制卡保存链（modal / dock 同一份：落库 → closeManual 换 key 清空表单） */
  const saveManual = async (p: Parameters<typeof sel.handleManualCard>[0]) => {
    try {
      return await sel.handleManualCard(p);
    } finally {
      sel.closeManual();
    }
  };
  /** D121 §4.1「保存并辨析」：弹窗挂在本组件（表单随换 key 卸载后仍存活）；新卡为 A、相似卡为 B */
  const [disamb, setDisamb] = useState<{ card: CardRecord; other: string } | null>(null);
  const openDisamb = async (newId: string, otherId: string) => {
    const card = await cardsApi.get(newId).catch(() => null);
    if (card) setDisamb({ card, other: otherId });
  };

  /** AI 面板元素（explain / cards+occlusion 两页签体共用同一 props；occlusion 归制卡页签） */
  const aiPanelNode = aiPanel ? (
    <AIPanel
      panel={aiPanel}
      onAccept={(d, idx, edited) => sel.acceptDraft(d, idx, edited)}
      onAcceptOcclusion={(d, idx) => sel.acceptOcclusionDraft(d, idx)}
      onEdit={(idx, patch) => {
        sel.setAiPanel((p) => {
          if (!p || !p.drafts) return p;
          const next = [...p.drafts];
          next[idx] = { ...next[idx], ...patch };
          return { ...p, drafts: next };
        });
      }}
      onSplitReverse={(idx) => {
        // v16（D18）：「转翻转卡」= 拆为两张互为翻转的独立 qa 草稿（各自有独立 FSRS 调度）
        sel.setAiPanel((p) => {
          if (!p || !p.drafts) return p;
          const d = p.drafts[idx];
          const a: CardDraft = { ...d, cardType: "qa", front: d.front, back: d.back };
          const b: CardDraft = {
            ...d,
            cardType: "qa",
            front: (d.back || "").trim() || d.front,
            back: d.front,
            cloze: null
          };
          const next = [...p.drafts.slice(0, idx), a, b, ...p.drafts.slice(idx + 1)];
          // 拆分点之后的已接受/补充标记索引整体右移一位，保持对位
          const accepted = new Set([...(p.accepted ?? [])].map((k) => (k > idx ? k + 1 : k)));
          const supplemental = new Set([...(p.supplemental ?? [])].map((k) => (k > idx ? k + 1 : k)));
          return { ...p, drafts: next, accepted, supplemental };
        });
      }}
      onRejectAll={sel.rejectAllDrafts}
      onExplain={(q) => sel.runExplain(aiPanel.text, q)}
      onAsk={(q) => void sel.runAsk(q)}
      onMakeCards={() => sel.runAICards(aiPanel.text, undefined, sel.aiMode)}
      onModeChange={(m) => sel.changeAiMode(m)}
      mode={sel.aiMode}
      onSearchBackground={() => sel.searchAndRetry(aiPanel.text)}
      onFollowUpCards={(item, kpTitle, hint) => sel.runFollowUpCards(item, kpTitle, hint)}
      onExploration={(item, kpTitle, srcKey) => sel.runExploration(item, kpTitle, srcKey)}
      explainMode={sel.explainMode}
      onExplainModeChange={(m) => sel.changeExplainMode(m)}
      // v48.74（D118 §3④）：生成中「停止」→ ai:abort 取消当前请求
      onStop={() => sel.stopAIRun()}
    />
  ) : null;
  // 「带入 AI 回答」：最近一条已完成的追问回答 > 当前解释面板的回答
  const latestAnswer = () => {
    const th = [...sel.thread].reverse().find((x) => x.answer && !x.running);
    if (th?.answer) return th.answer;
    return aiPanel?.kind === "explain" ? aiPanel.answer ?? "" : "";
  };
  // 手动制卡题型（题型页签在标题行里，表单受控）。「图片挖空」＝启动整屏截图（截完直接弹挖空编辑器），不切表单
  type ManualMode = "qa" | "reverse" | "cloze" | "imageOcclusion";
  const [manualMode, setManualMode] = useState<ManualMode>("qa");
  useEffect(() => setManualMode("qa"), [sel.manualSeq]);
  const pickMode = (m: ManualMode) => {
    if (m === "imageOcclusion") {
      void sel.startWorkbenchCapture();
      return;
    }
    setManualMode(m);
  };
  const MANUAL_TABS: Array<[ManualMode, string]> = [
    ["qa", "问答题"],
    ["reverse", "翻转问答"],
    ["cloze", "填空题"],
    ["imageOcclusion", "图片挖空"]
  ];
  // D144 #2：制卡板块页签切换（显式点击 > 内容派生）。v48.100（D144 #3）：hook 的 changeDockTab /
  // manualActive 已随旧页签坞退役——手动表单＝常驻页签体，无「手动暂态」概念。
  const changeCardsTab = (t: CardsTab) => {
    setCardsTab(t);
  };
  // 解释板块把手显隐（D144 §2.1）：仅有解释内容（解释面板在场或追问线程非空）或已展开时在场
  const hasExplainContent = aiPanel?.kind === "explain" || sel.thread.length > 0;
  // D144 §4.3 语义矩阵（悬浮按钮行，按钮双职＝迁移当前方式 + 发送/重跑）：
  // 「有解释语境」＝解释面板在场或线程非空；重跑仅解释面板可承接（changeExplainMode 按
  // kind==="explain" 门控，D91 §5.3 切换即重跑），仅线程在场而无面板时退化为仅置方式。
  const selectExplainMode = (m: ExplainComposerMode) => {
    setComposerMode(m);
    const text = composerText.trim();
    if (text) {
      // 有字：按该方式发送输入文字（§4.3「有文字」格全通——新语境盖旧语境，runExplain 清线程
      // 既有语义保留；自由提问走 runAsk 独立线程）；发送后清空（自动展开由 runExplain/runAsk 入口承接）
      if (m === "ask") void sel.runAsk(text);
      else void sel.runExplain(text, null, m);
      setComposerText("");
      return;
    }
    if (m === "ask") return; // 自由提问非解读方式：无字仅迁移当前方式（无重跑语义）
    // 空：仅置当前方式（会话内记忆＝hook explainMode）；解释面板在场则切换即重跑（D91）
    sel.changeExplainMode(m);
  };
  // Enter /「发送」钮＝按「当前方式」发送（§4.3）：ask→runAsk，其余→runExplain(文字, null, 方式)；
  // 自动展开由 hook 通道承接（runExplain/runAsk 入口 setExplainOpen(true)）
  const sendComposer = (q: string) => {
    const text = q.trim();
    if (!text) return;
    if (composerMode === "ask") void sel.runAsk(text);
    else void sel.runExplain(text, null, composerMode);
    setComposerText("");
  };
  const cardsOf = (text: string) => void sel.runAICards(text, undefined, sel.aiMode);
  const explainOf = (text: string) => void sel.runExplain(text, null);

  // ===== D144 #4（§4.2）：跨页签幽灵草稿同步 =====
  // 源（§6 受控上提/镜像）：AI 侧＝FreeSource 材料框文本；手动侧＝当前题型第一文本框
  // （ManualCardForm front 镜像；问答/翻转/图片挖空＝正面，填空＝挖空文本）。双向互为源/目标。
  const [freeText, setFreeText] = useState("");
  const [manualFront, setManualFront] = useState("");
  const manualFormRef = useRef<ManualFormHandle | null>(null);
  // 显示条件（§4.2 五要素）：目标页签＝当前页签 ∧ 目标首框空 ∧ 源非空 ∧（目标在 AI 侧时）制卡
  // 草稿面板不在场（FreeSource 可见＝幽灵挂点在 DOM）；（手动侧）图片挖空模式坞内无第一文本框，
  // 无挂点不出幽灵。cardsTab 单值 ⇒ 至多一处幽灵（§4.2）。消失三路（目标真实输入 / 源被清空 /
  // 切离页签）与接受后消失均由条件自然脱落＝卸载即瞬时（§8）；内容随源实时更新（派生自 state）。
  const aicardsFreeVisible = !(aiPanel && (aiPanel.kind === "cards" || aiPanel.kind === "occlusion"));
  const ghostTarget: "manual" | "aicards" | null =
    cardsTab === "manual"
      ? manualMode !== "imageOcclusion" && !manualFront.trim() && !!freeText.trim()
        ? "manual"
        : null
      : aicardsFreeVisible && !freeText.trim() && !!manualFront.trim()
        ? "aicards"
        : null;
  const ghostText = ghostTarget === "manual" ? freeText : ghostTarget === "aicards" ? manualFront : "";
  // 接受（§4.2）：把源全文写入目标首框（非 3 行截断；绝不回写源框——无损红线，§14 风险 3）；
  // 幽灵随目标非空自然消失；光标落文末由两侧宿主承接（FreeSource caret 收尾 / ManualFormHandle
  // .setFrontValue）。触发＝点击幽灵层（GhostLayer onAccept）或 Alt+Enter（目标输入面聚焦时，
  // GrowField/.wb-free-input 的 keydown；坞内固定键不经 CommandRegistry，D123 §1-11 Ctrl+K 同例）。
  const acceptGhost = () => {
    if (ghostTarget === "manual") manualFormRef.current?.setFrontValue(ghostText);
    else if (ghostTarget === "aicards") setFreeText(ghostText);
  };

  // ===== D144 #5（§4.4）：解释板块内选区三按钮选单 =====
  // 触发：解释内容区（引用块 / 答案 / 追问线程文本，容器＝wb-explain-body）选中 ≥1 字符，
  // mouseup 后出现于选区上方（popoverPlace prefer above，放不下自动翻下方）。关闭四路：
  // 执行任一动作（三回调内 closeTrio）/ Esc / 点击选单外（mousedown 判 .dock-trio 外）/ 选区坍塌
  // （selectionchange）。收起态内容区不可见无法选中＝天然不触发；选中后把手收起 / 坞收起 →
  // 由下方 effect 一并关闭。监听挂 document（选单为 fixed 浮层，与 SelectionMenu 同域视口坐标）。
  const [trio, setTrio] = useState<{ anchor: PopoverRect; text: string } | null>(null);
  const closeTrio = () => setTrio(null);
  useEffect(() => {
    const onUp = () => {
      // mouseup 后选区才最终稳定：让一拍再读（与触发语义「mouseup 后出现」一致）
      window.setTimeout(() => {
        const s = window.getSelection();
        if (!s || s.isCollapsed || s.rangeCount === 0) return;
        const body = document.querySelector('[data-testid="wb-explain-body"]');
        if (!body || !body.contains(s.anchorNode)) return;
        const text = s.toString();
        if (!text.trim()) return;
        const rect = s.getRangeAt(0).getBoundingClientRect();
        setTrio({ anchor: { x: rect.left, y: rect.top, width: rect.width, height: rect.height }, text });
      }, 0);
    };
    const onSelChange = () => {
      setTrio((t) => (t && (window.getSelection()?.isCollapsed ?? true) ? null : t));
    };
    const onDown = (e: MouseEvent) => {
      setTrio((t) => (t && !(e.target instanceof Element && e.target.closest(".dock-trio")) ? null : t));
    };
    const onKey = (e: KeyboardEvent) => {
      // §4.4 关闭「Esc」＝单层语义：仅 trio 在场才消费（preventDefault——独立窗口 workbench 的
      // Esc 收窗判据为 !e.defaultPrevented，浮层消费 Esc 不再连锁收窗；trio 不在场不拦截）
      if (e.key === "Escape") setTrio((t) => (t ? (e.preventDefault(), null) : t));
    };
    document.addEventListener("mouseup", onUp);
    document.addEventListener("selectionchange", onSelChange);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("selectionchange", onSelChange);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
  // 选中后解释板块收起（把手）或坞收起 → 内容区不可见，选单一并关闭
  useEffect(() => {
    if (!sel.explainOpen || !dockOpen) setTrio(null);
  }, [sel.explainOpen, dockOpen]);
  // §4.4-a「AI 制卡」：runAICards(选中文本) 既有管线零改动（坞内选区不经阅读器选区通道，
  // 故直调而非 actAICards——后者取文口为 A().selectionText()）；坞展开 + 切「AI 制卡」页签 +
  // 流式草稿面板均由既有派生链承接（hook 新内容到达唤坞 effect + 本组件 aiPanel.kind effect）
  const trioAICards = (text: string) => {
    const t = text.trim();
    if (!t) return;
    void sel.runAICards(t, undefined, sel.aiMode);
    closeTrio();
  };
  // §4.4-b「复制」：写入手动制卡当前题型第一文本框——空→直写；非空→末尾补两个换行后追加
  // （永不覆盖既有输入）；聚焦该框文末＝ManualFormHandle.setFrontValue 内置 caret 收尾；
  // 落点＝坞展开 + 切「手动制卡」页签；真实内容到达 → 手动侧幽灵条件自然脱落（§4.2，零专门清理）
  const trioCopy = (text: string) => {
    const t = text.trim();
    if (!t) return;
    const cur = manualFront.replace(/\s*$/, "");
    manualFormRef.current?.setFrontValue(cur ? `${cur}\n\n${t}` : t);
    setCardsTab("manual");
    sel.expandDock();
    closeTrio();
  };
  // §4.4-c「引用」：ChatComposer.insertQuote 头插「> 选中文本」+空行（既有草稿保留其后）、聚焦
  // 输入框文末、板块保持收起（不动 explainOpen——用户尚未发送）
  const trioQuote = (text: string) => {
    if (!text.trim()) return;
    composerRef.current?.insertQuote(text);
    closeTrio();
  };

  return (
    <>
      {dictPanel && (
        <DictPanel
          panel={dictPanel}
          reading={sel.dictReading}
          popupFields={sel.dictFields}
          manualLang={sel.dictManualLang}
          onClose={() => sel.setDictPanel(null)}
          onRetry={() => void sel.runLookup(false, dictPanel.selectedText)}
          onUseLocal={() => void sel.runLookup(true, dictPanel.selectedText)}
          // v38（D35）：面板语言切换——以对应语言重查（"auto"=清除手动选择走自动路由）
          onSelectLanguage={(lang) => {
            sel.setDictManualLangBoth(lang === "auto" ? null : lang);
            void sel.runLookup(false, dictPanel.selectedText);
          }}
          onMakeCards={(entry: DictionaryEntry, ctx: ReadingContext, kinds: VocabKind[]) => void sel.acceptVocabCards(entry, ctx, kinds)}
        />
      )}
      {/* 图片挖空（manualImage 在场＝来自图片聚焦工具条）维持 modal，不入坞（D88/D92 语义不变） */}
      {manualOpen && manualImage && (
        <ManualCardEditor
          quote={manualQuote ?? ""}
          imageRegion={manualImage}
          onCancel={sel.closeManual}
          onSave={saveManual}
        />
      )}

      {/* D123 修订 3：制卡台「图片挖空 → 截图」产生的编辑器（阅读器自己的点击图片入口仍由 Reader 渲染） */}
      {sel.occlEditor?.workbench && (
        <OcclusionEditor
          image={sel.occlEditor.image}
          origin={sel.occlEditor.origin}
          onAISuggest={sel.runOcclusionSuggest}
          onClose={sel.closeOcclusionEditor}
          onSubmit={sel.submitOcclusionEditor}
        />
      )}

      {/* 制卡台：首次唤起后挂载；收起≠关闭（面板滑出、状态保留）；展开/收起只经顶栏按钮 / Ctrl+K / Esc */}
      {sel.dockEverOpened && (
        <div ref={dockRootRef} className="wb-root">
          <CardDock
            tab={cardsTab}
            onTabChange={changeCardsTab}
            placement={placement}
            dockOpen={dockOpen}
            manualCollapsed={manualCollapsed}
            onToggleManual={() => setManualCollapsed((v) => !v)}
            onCollapse={sel.collapseDock}
            manualTabs={
              <div className="wb-tabs" role="tablist" aria-label="卡片类型" data-testid="manual-types">
                {MANUAL_TABS.map(([m, label]) => (
                  <button key={m} type="button" role="tab" aria-selected={manualMode === m} className={manualMode === m ? "on" : undefined} onClick={() => pickMode(m)}>
                    {label}
                  </button>
                ))}
              </div>
            }
            manual={
              <ManualCardForm
                key={sel.manualSeq}
                ref={manualFormRef}
                variant="dock"
                mode={manualMode}
                onModeChange={setManualMode}
                quote={manualQuote ?? ""}
                tagSuggestions={tagVocab}
                initialTags={sel.manualTagsInitial}
                onCancel={sel.closeManual}
                onSave={saveManual}
                onDisambiguate={(n, o) => void openDisamb(n, o)}
                onPickSelection={() => sel.readSelectionText()}
                onPickAnswer={latestAnswer}
                onFrontChange={setManualFront}
                ghost={ghostTarget === "manual" ? <GhostLayer text={ghostText} onAccept={acceptGhost} /> : null}
                onGhostAccept={acceptGhost}
              />
            }
            aicards={
              <div className="wb-scroll">
                {aiPanel && (aiPanel.kind === "cards" || aiPanel.kind === "occlusion") ? (
                  <>
                    {aiPanel.kind === "occlusion" && <div className="dock-badge mono">图片挖空</div>}
                    {aiPanelNode}
                  </>
                ) : (
                  <div className="dock-empty" data-dock-empty="cards">
                    <FreeSource
                      prefer="cards"
                      text={freeText}
                      onTextChange={setFreeText}
                      ghostText={ghostTarget === "aicards" ? ghostText : undefined}
                      onGhostAccept={acceptGhost}
                      onExplain={explainOf}
                      onCards={cardsOf}
                    />
                  </div>
                )}
              </div>
            }
            explainOpen={sel.explainOpen}
            onToggleExplain={() => sel.setExplainOpen((v) => !v)}
            explainHandleVisible={sel.explainOpen || hasExplainContent}
            explainBody={
              /* 解释内容槽（D144 §4.3）：既有解释页签内容整体平移（引用块/状态行/答案/事后建议/
                 追问 chips/就此制卡）+ 追问线程；空态不再渲染 FreeSource——解释入口唯一归口＝
                 底部输入条（§10 退役项，D144 #3） */
              <>
                {aiPanel?.kind === "explain" ? aiPanelNode : null}
                <ExplainThread items={sel.thread} onMake={(answer) => cardsOf(answer)} />
              </>
            }
            explainModeBar={
              /* D144 §4.3：四 ghost 钮（自动｜通用解读｜简明解读｜自由提问），语义矩阵在 selectExplainMode */
              <ExplainModeBar
                mode={composerMode}
                hasText={!!composerText.trim()}
                hasContext={hasExplainContent}
                onModeSelect={selectExplainMode}
              />
            }
            explainComposer={
              <ChatComposer
                ref={composerRef}
                busy={threadBusy}
                value={composerText}
                onValueChange={setComposerText}
                onSend={sendComposer}
              />
            }
          />
        </div>
      )}
      {/* D144 #5（§4.4）：解释内容区选区三按钮选单（fixed 浮层，位置随 trio.anchor） */}
      {trio && (
        <DockTrioMenu anchor={trio.anchor} text={trio.text} onAiCards={trioAICards} onCopy={trioCopy} onQuote={trioQuote} />
      )}
      {disamb && (
        <DisambiguateModal card={disamb.card} presetOther={disamb.other} origin="manual" onClose={() => setDisamb(null)} />
      )}
    </>
  );
}
