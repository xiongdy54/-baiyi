// 选区动作的三个面板（手动制卡 / 查词 / AI）——批 4 Task 10 从 Reader.tsx 原样搬出，
// 摘录页与阅读器共用同一份渲染（§4 纪律：抽完后宿主不得保留实现副本，防两份漂移）。
// 本组件只做「把 useSelectionActions 的状态与回调接到既有面板上」，不含任何业务逻辑。
// D88 P3（§8.1/§8.3）：手动制卡与 AI 两态统一换渲染容器为右侧制卡面板 CardDock。
// v48.52（D92 §4）：从「按状态分别渲染 CardDock」重构为**单坞常驻编排**——首次唤起后挂载不卸：
// 坞头双页签（AI 解释｜AI 制卡）+ 三类体内容（AI 页签体 / 手动暂态 / 空态）。
// 页签体**隐藏保活**（display:none 不卸载：流式继续、表单草稿不丢）；关闭链语义零改动
// （AI 态 ×＝批次 reject + setAiPanel(null)；手动 ×＝closeManual；Esc 仅手动暂态）；词典面板/图片挖空
// modal 维持独立弹窗不入坞。
import ManualCardEditor, { ManualCardForm } from "./ManualCardEditor";
import CardDock, { type DockTab } from "./CardDock";
import AIPanel, { ExplainModeSwitcher } from "./AIPanel";
import { DictPanel } from "./DictPanel";
import { useEffect, useState } from "react";
import { cardsApi, type CardDraft, type CardRecord } from "../lib/cards";
import DisambiguateModal from "./DisambiguateModal";
import type { TagVocabEntry } from "../lib/tags";
import type { DictionaryEntry, ReadingContext, VocabKind } from "../lib/dict";
import type { SelectionActions } from "../lib/useSelectionActions";

export default function SelectionPanels({
  sel,
  selectionText,
  nowTick = 0,
  elapsedSec,
  dockMeta
}: {
  /** useSelectionActions 的返回值（原样传入；类型即钩子返回值，不另立影子类型） */
  sel: SelectionActions;
  /** 引用文本兜底（手动制卡浮层：manualQuote 为空时用当前选区文本） */
  selectionText?: string | null;
  /** AI 面板计时（宿主每秒一跳） */
  nowTick?: number;
  elapsedSec: number;
  /** dock 头行 meta（材料名，§8.2「有则显，无则省」） */
  dockMeta?: string;
}) {
  const { aiPanel, manualOpen, manualImage, manualQuote, dictPanel, dockOpen, dockTab, manualActive } = sel;
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
  }, [sel.manualOpen, sel.dockOpen]);
  /** 手动制卡保存链（modal / dock 同一份：落库 → closeManual，现状语义零改动） */
  const saveManual = async (p: Parameters<typeof sel.handleManualCard>[0]) => {
    try {
      return await sel.handleManualCard(p);
    } finally {
      sel.closeManual();
    }
  };
  /** D121 §4.1「保存并辨析」：弹窗挂在本组件（表单随 closeManual 卸载后仍存活）；新卡为 A、相似卡为 B */
  const [disamb, setDisamb] = useState<{ card: CardRecord; other: string } | null>(null);
  const openDisamb = async (newId: string, otherId: string) => {
    const card = await cardsApi.get(newId).catch(() => null);
    if (card) setDisamb({ card, other: otherId });
  };
  /** 关闭链（D92 §4 原样迁移）：手动暂态 ×＝closeManual（丢草稿）；AI 态 ×＝批次 reject + 清面板；
      空坞 ×＝收起（常驻坞没有「关闭」，收起把手仍在）。 */
  const closeDock = () => {
    if (manualActive) {
      sel.closeManual();
      return;
    }
    if (aiPanel) {
      if (
        (aiPanel.kind === "cards" || aiPanel.kind === "occlusion") &&
        aiPanel.batchId &&
        aiPanel.drafts?.length
      ) {
        cardsApi.setBatchStatus(aiPanel.batchId, "rejected");
      }
      sel.setAiPanel(null);
      return;
    }
    sel.collapseDock();
  };
  /** AI 面板元素（explain / cards+occlusion 两页签体共用同一 props；occlusion 归制卡页签） */
  const aiPanelNode = aiPanel ? (
    <AIPanel
      panel={{ ...aiPanel, elapsedSec }}
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
      onMakeCards={() => sel.runAICards(aiPanel.text, undefined, sel.aiMode)}
      onModeChange={(m) => sel.changeAiMode(m)}
      mode={sel.aiMode}
      onSearchBackground={() => sel.searchAndRetry(aiPanel.text)}
      onFollowUpCards={(item, kpTitle, hint) => sel.runFollowUpCards(item, kpTitle, hint)}
      onExploration={(item, kpTitle) => sel.runExploration(item, kpTitle)}
      explainMode={sel.explainMode}
      onExplainModeChange={(m) => sel.changeExplainMode(m)}
      // v48.74（D118 §3④）：生成中「停止」→ ai:abort 取消当前请求
      onStop={() => sel.stopAIRun()}
      elapsedTick={nowTick}
    />
  ) : null;
  /** 页签体可见性：手动暂态占坞时两页签体皆隐藏（保活）；否则显示活动页签 */
  const tabVisible = (t: DockTab) => !manualActive && dockTab === t;

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
          quote={manualQuote ?? selectionText ?? ""}
          imageRegion={manualImage}
          onCancel={sel.closeManual}
          onSave={saveManual}
        />
      )}

      {/* v48.52（D92）：单坞常驻——首次唤起后挂载；收起≠关闭（坞体滑出、把手常驻、状态保留） */}
      {sel.dockEverOpened && (
        <CardDock
          mode={manualActive ? "manual" : "ai"}
          tab={dockTab}
          onTabChange={(t) => sel.changeDockTab(t)}
          meta={dockMeta}
          manualActive={manualActive}
          onManual={() => sel.actions.manual()}
          streaming={!!aiPanel?.running}
          manualDraft={manualOpen && !manualImage}
          dockOpen={dockOpen}
          onCollapse={sel.collapseDock}
          onExpand={sel.expandDock}
          onClose={closeDock}
        >
          {/* AI 解释页签体（保活；空态＝页签恒可点的 D84 惯例，方式可先调） */}
          <div className="dock-tabbody" data-dock-tabbody="explain" style={tabVisible("explain") ? undefined : { display: "none" }}>
            {aiPanel?.kind === "explain" ? (
              aiPanelNode
            ) : (
              <div className="dock-empty" data-dock-empty="explain">
                <p className="dock-empty-hint">选中文字后点工具栏「AI 解释」开始。</p>
                <p className="dock-empty-hint">也可先在此选好解读方式：</p>
                <ExplainModeSwitcher value={sel.explainMode} onChange={(m) => sel.changeExplainMode(m)} />
              </div>
            )}
          </div>
          {/* AI 制卡页签体（保活；occlusion＝AI 图片挖空归此页签，体内保留徽章） */}
          <div className="dock-tabbody" data-dock-tabbody="cards" style={tabVisible("cards") ? undefined : { display: "none" }}>
            {aiPanel && (aiPanel.kind === "cards" || aiPanel.kind === "occlusion") ? (
              <>
                {aiPanel.kind === "occlusion" && <div className="dock-badge mono">图片挖空</div>}
                {aiPanelNode}
              </>
            ) : (
              <div className="dock-empty" data-dock-empty="cards">
                <p className="dock-empty-hint">选中文字后点「AI 制卡」开始。</p>
              </div>
            )}
          </div>
          {/* 手动暂态（保活）：占坞体时两页签非激活、「＋制卡」active；切页签隐藏不卸载、草稿不丢 */}
          {manualOpen && !manualImage && (
            <div className="dock-tabbody" data-dock-tabbody="manual" style={manualActive ? undefined : { display: "none" }}>
              <ManualCardForm
                quote={manualQuote ?? selectionText ?? ""}
                tagSuggestions={tagVocab}
                initialTags={sel.manualTagsInitial}
                onCancel={sel.closeManual}
                onSave={saveManual}
                onDisambiguate={(n, o) => void openDisamb(n, o)}
              />
            </div>
          )}
        </CardDock>
      )}
      {disamb && (
        <DisambiguateModal card={disamb.card} presetOther={disamb.other} origin="manual" onClose={() => setDisamb(null)} />
      )}
    </>
  );
}
