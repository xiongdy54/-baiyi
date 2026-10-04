// 选区动作的三个面板（手动制卡 / 查词 / AI）——批 4 Task 10 从 Reader.tsx 原样搬出，
// 摘录页与阅读器共用同一份渲染（§4 纪律：抽完后宿主不得保留实现副本，防两份漂移）。
// 本组件只做「把 useSelectionActions 的状态与回调接到三个既有面板上」，不含任何业务逻辑。
// D88 P3（§8.1/§8.3）：手动制卡与 AI 两态统一换渲染容器为右侧制卡面板 CardDock——
// 只换容器，useSelectionActions 的状态机、Esc/失焦/保存后关闭（closeManual）、
// AI 批次 reject 逻辑零改动；图片挖空（manualImage 在场＝来自图片聚焦工具条）维持 modal。
import ManualCardEditor, { ManualCardForm } from "./ManualCardEditor";
import CardDock from "./CardDock";
import { DictPanel } from "./DictPanel";
import AIPanel from "./AIPanel";
import { cardsApi, type CardDraft } from "../lib/cards";
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
  const { aiPanel, manualOpen, manualImage, manualQuote, dictPanel } = sel;
  /** 手动制卡保存链（modal / dock 同一份：落库 → closeManual，现状语义零改动） */
  const saveManual = async (p: Parameters<typeof sel.handleManualCard>[0]) => {
    try {
      await sel.handleManualCard(p);
    } finally {
      sel.closeManual();
    }
  };
  /** AI 态标题（§8.2 随态换文案；原 AIPanel 头行逻辑随标题并入 dock 头） */
  const aiTitle = aiPanel
    ? aiPanel.kind === "explain"
      ? "AI 解释"
      : aiPanel.kind === "occlusion"
        ? "图片挖空"
        : "AI 制卡"
    : "";
  return (
    <>
      {/* 手动态（§8.3）：工具栏「制卡」/ 标记浮层「就此制卡」→ dock（quote=选区/标记文本）；
          图片挖空（manualImage 在场）→ 维持 modal（§8.2） */}
      {manualOpen && !manualImage && (
        <CardDock mode="manual" title="手动制卡" meta={dockMeta} onClose={sel.closeManual}>
          <ManualCardForm
            quote={manualQuote ?? selectionText ?? ""}
            onCancel={sel.closeManual}
            onSave={saveManual}
          />
        </CardDock>
      )}
      {manualOpen && manualImage && (
        <ManualCardEditor
          quote={manualQuote ?? selectionText ?? ""}
          imageRegion={manualImage}
          onCancel={sel.closeManual}
          onSave={saveManual}
        />
      )}

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

      {/* AI 态（§8.3）：AI 制卡 / AI 解释 → dock（视觉统一，逻辑同前——关闭链含批次 reject 原样） */}
      {aiPanel && (
        <CardDock
          mode="ai"
          title={aiTitle}
          meta={dockMeta}
          onClose={() => {
            if (
              (aiPanel.kind === "cards" || aiPanel.kind === "occlusion") &&
              aiPanel.batchId &&
              aiPanel.drafts?.length
            ) {
              cardsApi.setBatchStatus(aiPanel.batchId, "rejected");
            }
            sel.setAiPanel(null);
          }}
        >
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
            elapsedTick={nowTick}
          />
        </CardDock>
      )}
    </>
  );
}
