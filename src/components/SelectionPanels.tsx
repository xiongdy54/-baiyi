// 选区动作的面板编排（手动制卡 / 查词 / AI）——批 4 Task 10 从 Reader.tsx 原样搬出，
// 摘录页、阅读器与自由宿主（其余页面 / 独立窗口）共用同一份渲染（§4 纪律：宿主不得保留实现副本）。
// 本组件只做「把 useSelectionActions 的状态与回调接到既有面板上」，不含业务逻辑。
// v48.79（D123）：学习坞升级为「制卡台」——手动制卡表单**常驻**（可收成仅标题行，草稿保留），
// AI 区为页签（解释｜制卡）；入口只有顶栏按钮 / Ctrl+K（经 wb:toggle 事件开合），不再有坞内关闭钮与把手。
// 页签体隐藏保活（display:none 不卸载：流式继续、表单草稿不丢）；词典面板/图片挖空 modal 维持独立弹窗不入坞。
import ManualCardEditor, { ManualCardForm } from "./ManualCardEditor";
import CardDock, { type DockTab } from "./CardDock";
import AIPanel, { ChatComposer, ExplainModeSwitcher, ExplainThread } from "./AIPanel";
import { DictPanel } from "./DictPanel";
import { useEffect, useRef, useState } from "react";
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

/** 无选区/无面板时的自由材料输入：粘贴或输入一段文字 → AI 解释 / AI 制卡（自由模式与独立窗口的主入口） */
function FreeSource({ onExplain, onCards, prefer }: { onExplain: (t: string) => void; onCards: (t: string) => void; prefer: "explain" | "cards" }) {
  const [text, setText] = useState("");
  const t = text.trim();
  return (
    <div className="wb-free" data-testid="wb-free-source">
      <textarea
        value={text}
        placeholder="粘贴或输入要处理的文字（也可在阅读时选中文字，用浮条的 AI 解释 / AI 制卡）"
        aria-label="待处理文字"
        rows={4}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="wb-free-acts">
        <button type="button" className={`btn btn-sm ${prefer === "explain" ? "btn-primary" : "btn-outline"}`} disabled={!t} onClick={() => onExplain(t)}>
          AI 解释
        </button>
        <button type="button" className={`btn btn-sm ${prefer === "cards" ? "btn-primary" : "btn-outline"}`} disabled={!t} onClick={() => onCards(t)}>
          AI 制卡
        </button>
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
  const { aiPanel, manualOpen, manualImage, manualQuote, dictPanel, dockOpen, dockTab } = sel;
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
  const dockRootRef = useRef<HTMLDivElement | null>(null);

  /** 把焦点交给手动表单的第一个可输入字段（点开即可打字，D88 §15 注记延续） */
  const focusManual = () => {
    window.setTimeout(() => {
      const root = document.querySelector('[data-testid="wb-manual"]');
      const first = root?.querySelector('textarea, input:not([type=checkbox]):not([type=range]), [contenteditable="true"]');
      (first as HTMLElement | null)?.focus();
    }, 80);
  };

  // 顶栏按钮 / Ctrl+K → 开合制卡台（每个页面恰有一个宿主挂着本组件）
  const toggleRef = useRef<() => void>(() => {});
  toggleRef.current = () => {
    if (placementOverride === "window") return;
    if (!sel.dockEverOpened || !sel.dockOpen) {
      setManualCollapsed(false);
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

  // 工具栏/浮条「制卡」（actions.manual）唤坞时：手动区展开并聚焦
  useEffect(() => {
    if (sel.manualOpen && !sel.manualImage) {
      setManualCollapsed(false);
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
  const tabVisible = (t: DockTab) => dockTab === t;
  const cardsOf = (text: string) => void sel.runAICards(text, undefined, sel.aiMode);
  const explainOf = (text: string) => void sel.runExplain(text, null);

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

      {/* 制卡台：首次唤起后挂载；收起≠关闭（面板滑出、状态保留）；展开/收起只经顶栏按钮 / Ctrl+K / Esc */}
      {sel.dockEverOpened && (
        <div ref={dockRootRef} className="wb-root">
          <CardDock
            tab={dockTab}
            onTabChange={(t) => sel.changeDockTab(t)}
            meta={dockMeta}
            placement={placement}
            dockOpen={dockOpen}
            manualCollapsed={manualCollapsed}
            onToggleManual={() => setManualCollapsed((v) => !v)}
            onCollapse={sel.collapseDock}
            manual={
              <ManualCardForm
                key={sel.manualSeq}
                variant="dock"
                quote={manualQuote ?? ""}
                tagSuggestions={tagVocab}
                initialTags={sel.manualTagsInitial}
                onCancel={sel.closeManual}
                onSave={saveManual}
                onDisambiguate={(n, o) => void openDisamb(n, o)}
              />
            }
          >
            {/* AI 解释页签体（保活）：解读/回答 + 自由追问线程 + 底部输入条 */}
            <div className="dock-tabbody" data-dock-tabbody="explain" style={tabVisible("explain") ? undefined : { display: "none" }}>
              <div className="wb-scroll">
                {aiPanel?.kind === "explain" ? (
                  aiPanelNode
                ) : sel.thread.length === 0 ? (
                  <div className="dock-empty" data-dock-empty="explain">
                    <ExplainModeSwitcher value={sel.explainMode} onChange={(m) => sel.changeExplainMode(m)} />
                    <FreeSource prefer="explain" onExplain={explainOf} onCards={cardsOf} />
                  </div>
                ) : null}
                <ExplainThread items={sel.thread} onMake={(answer) => cardsOf(answer)} />
              </div>
              <ChatComposer busy={threadBusy} onSend={(q) => void sel.runAsk(q)} />
            </div>
            {/* AI 制卡页签体（保活；occlusion＝AI 图片挖空归此页签，体内保留徽章） */}
            <div className="dock-tabbody" data-dock-tabbody="cards" style={tabVisible("cards") ? undefined : { display: "none" }}>
              <div className="wb-scroll">
                {aiPanel && (aiPanel.kind === "cards" || aiPanel.kind === "occlusion") ? (
                  <>
                    {aiPanel.kind === "occlusion" && <div className="dock-badge mono">图片挖空</div>}
                    {aiPanelNode}
                  </>
                ) : (
                  <div className="dock-empty" data-dock-empty="cards">
                    <FreeSource prefer="cards" onExplain={explainOf} onCards={cardsOf} />
                  </div>
                )}
              </div>
            </div>
          </CardDock>
        </div>
      )}
      {disamb && (
        <DisambiguateModal card={disamb.card} presetOther={disamb.other} origin="manual" onClose={() => setDisamb(null)} />
      )}
    </>
  );
}
