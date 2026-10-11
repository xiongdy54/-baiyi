// v48.80（D124 / 设计稿 §11.4）：数据页顶部「下一步」面板。
// 推荐列表 + 主按钮 + ⋯菜单（反馈）+ 母语确认行 + 隐式轨道提示 + 首次索引轮询。
// app.learner.enabled === false 时不渲染（不留空白）；对话框动作在本面板内部处理，页面跳转经 learner/navigate 交 App。
import { useCallback, useEffect, useRef, useState } from "react";
import { eventBus } from "../../lib/eventbus";
import { learnerApi, learnerSettings, languageDisplayName, type LearnerStatus, type RecItem } from "../../lib/learner";
import { learnerStrings } from "../../lib/learnerStrings";
import Dropdown from "../Dropdown";
import TracksDialog from "./TracksDialog";
import SelfExplainDialog from "./SelfExplainDialog";
import UnitReaderDialog from "./UnitReaderDialog";
import ContextReelDialog from "./ContextReelDialog";
import SentenceMineDialog from "./SentenceMineDialog";
import PlacementDialog from "./PlacementDialog";

type RecommendState = {
  items: RecItem[];
  runId: string | null;
  generatedAt: number | null;
  candidateCount: number;
  usingProposals: boolean;
  indexing: boolean;
  error: string;
};

const INITIAL: RecommendState = { items: [], runId: null, generatedAt: null, candidateCount: 0, usingProposals: false, indexing: false, error: "" };

function hhmm(ts: number | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function NextStepsPanel() {
  const S = learnerStrings();
  const [enabled, setEnabled] = useState<boolean | null>(null); // null = 读取中
  const [recCount, setRecCount] = useState(6);
  const [nativeConfirmed, setNativeConfirmed] = useState(true);
  const [effectiveNativeLangs, setEffectiveNativeLangs] = useState<string[]>([]);
  const [state, setState] = useState<RecommendState>(INITIAL);
  const [status, setStatus] = useState<LearnerStatus | null>(null);
  const [removedKeys, setRemovedKeys] = useState<Set<string>>(new Set());
  const [tracksOpen, setTracksOpen] = useState(false);
  const [tracksFocusNative, setTracksFocusNative] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dialog, setDialog] = useState<{ kind: string; item: RecItem } | null>(null);
  const pollRef = useRef<number | null>(null);

  const readSettings = useCallback(async () => {
    const s = await learnerSettings.read();
    setEnabled(s.enabled);
    setRecCount(s.recCount);
    setNativeConfirmed(s.nativeConfirmed);
    setEffectiveNativeLangs(s.effectiveNativeLangs);
    return s.enabled;
  }, []);

  const requestRecommend = useCallback(
    async (force = false) => {
      try {
        const r = await learnerApi.recommend(force);
        setState({
          items: r.items || [],
          runId: r.runId,
          generatedAt: r.generatedAt,
          candidateCount: r.candidateCount || 0,
          usingProposals: Boolean(r.usingProposals),
          indexing: Boolean(r.indexing),
          error: r.error || ""
        });
        if (r.indexing) startPolling();
      } catch (err) {
        setState((prev) => ({ ...prev, indexing: false, error: err instanceof Error ? err.message : String(err) }));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const startPolling = useCallback(() => {
    if (pollRef.current != null) return;
    pollRef.current = window.setInterval(async () => {
      try {
        const st = await learnerApi.status();
        setStatus(st);
        if (!st.indexing) {
          if (pollRef.current != null) {
            window.clearInterval(pollRef.current);
            pollRef.current = null;
          }
          void requestRecommend();
        }
      } catch {
        /* 轮询失败下次再试 */
      }
    }, 1000);
  }, [requestRecommend]);

  useEffect(() => {
    void (async () => {
      const on = await readSettings();
      if (on) void requestRecommend();
    })();
    const offSettings = eventBus.on("settings/changed", (p) => {
      if ((p as { scope?: string; key?: string } | undefined)?.key !== "learner") return;
      void (async () => {
        const on = await readSettings();
        if (on) void requestRecommend();
        else setState(INITIAL);
      })();
    });
    const offChanged = eventBus.on("learner/changed", () => {
      void requestRecommend();
    });
    return () => {
      offSettings();
      offChanged();
      if (pollRef.current != null) window.clearInterval(pollRef.current);
    };
  }, [readSettings, requestRecommend]);

  async function sendFeedback(item: RecItem, action: string) {
    try {
      await learnerApi.feedback({ runId: state.runId, itemKey: item.key, kind: item.kind, libraryItemId: item.libraryItemId, action });
    } catch {
      /* 反馈失败静默 */
    }
  }

  function removeFromList(item: RecItem) {
    setRemovedKeys((prev) => new Set(prev).add(item.key));
  }

  function primary(item: RecItem) {
    void sendFeedback(item, "opened");
    const a = item.action;
    if (a.type === "open-book") eventBus.emit("learner/navigate", { type: "open-book", libraryItemId: a.libraryItemId });
    else if (a.type === "jump") eventBus.emit("learner/navigate", { type: "jump", documentId: a.documentId, anchor: a.anchor });
    else if (a.type === "review") eventBus.emit("learner/navigate", { type: "review", scopeKpIds: a.scopeKpIds, title: a.title || item.title });
    else if (a.type === "extract-session") eventBus.emit("learner/navigate", { type: "extract-session", bookItemIds: a.bookItemIds, title: a.title || item.title });
    else if (a.type === "copy-query") {
      void navigator.clipboard.writeText(a.text).then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      });
    } else if (a.type === "dialog") setDialog({ kind: a.dialog, item });
  }

  function menu(item: RecItem, action: string) {
    void sendFeedback(item, action);
    removeFromList(item);
  }

  if (enabled === null || enabled === false) return null;

  const items = state.items.filter((it) => !removedKeys.has(it.key));
  // 设计稿 §11.4「你的母语是 {语言名列表} 吗？」——语言名按界面语言生成（Intl.DisplayNames），不显示代码
  const nativeLangsText = effectiveNativeLangs.map((c) => languageDisplayName(c)).join("、");
  const tooHardKinds = new Set(["continue", "start", "reread"]);

  return (
    <section className="dash-page learner-panel" aria-label={S.panel.title}>
      <div className="learner-panel-card card-fill">
        <div className="learner-head">
          <h2>{S.panel.title}</h2>
          <div className="learner-head-right">
            {!state.indexing && state.generatedAt && (
              <span className="learner-meta">
                {S.panel.headerMeta(hhmm(state.generatedAt), state.candidateCount)}
              </span>
            )}
            <button className="btn-link" onClick={() => void requestRecommend(true)}>
              {S.panel.refresh}
            </button>
            <button
              className="btn-link"
              onClick={() => {
                setTracksFocusNative(false);
                setTracksOpen(true);
              }}
            >
              {S.panel.tracks}
            </button>
            <Dropdown
              value={String(recCount)}
              title={S.settings.recCount}
              align="right"
              options={[3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({ value: String(n), label: `${n} ${S.panel.countSuffix}`.trim() }))}
              onChange={(n) => {
                const v = Number(n);
                setRecCount(v);
                void learnerSettings.write({ recCount: v });
              }}
            />
          </div>
        </div>

        {nativeConfirmed === false && (
          <div className="learner-notice">
            <span>{nativeLangsText ? S.panel.nativeConfirm(nativeLangsText) : S.panel.nativeEmpty}</span>
            {nativeLangsText ? (
              <>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => void learnerSettings.write({ nativeLangs: effectiveNativeLangs, nativeConfirmed: true }).then(() => setNativeConfirmed(true))}
                >
                  {S.panel.nativeConfirmYes}
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setTracksFocusNative(true);
                    setTracksOpen(true);
                  }}
                >
                  {S.panel.nativeConfirmChange}
                </button>
              </>
            ) : (
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setTracksFocusNative(true);
                  setTracksOpen(true);
                }}
              >
                {S.panel.nativeEmptySet}
              </button>
            )}
          </div>
        )}
        {nativeConfirmed !== false && state.usingProposals && (
          <div className="learner-notice">
            <span>{S.panel.usingProposals}</span>
            <button className="btn btn-secondary btn-sm" onClick={() => setTracksOpen(true)}>
              {S.panel.confirmTracks}
            </button>
          </div>
        )}

        {state.indexing && (
          <div className="learner-notice">
            <span>
              {S.panel.indexing(
                status?.phase || "",
                status?.done ?? 0,
                status?.total ?? 0
              )}
            </span>
          </div>
        )}
        {!state.indexing && state.error && (
          <div className="learner-notice">
            <span className="learner-error">{state.error}</span>
            <button className="btn btn-secondary btn-sm" onClick={() => void requestRecommend(true)}>
              {S.panel.retry}
            </button>
          </div>
        )}
        {!state.indexing && !state.error && items.length === 0 && <p className="learner-empty">{S.panel.empty}</p>}
        {!state.indexing && copied && <p className="learner-copied">{S.panel.copied}</p>}

        <ul className="learner-list">
          {items.map((item) => {
            const a = item.action;
            let primaryLabel = S.panel.primaryButton[item.kind] || S.panel.title;
            if (item.kind === "reinforce") primaryLabel = a.type === "review" ? S.panel.reinforceReview : S.panel.reinforceReread;
            return (
              <li className="learner-item" key={item.key}>
                <div className="learner-item-main">
                  <span className="learner-item-kind">
                    {S.kinds[item.kind] || item.kind} · {item.trackLabel}
                  </span>
                  <span className="learner-item-title" dir="auto">
                    {item.title}
                  </span>
                  <span className="learner-item-reason" dir="auto">
                    {item.reason}
                  </span>
                </div>
                <div className="learner-item-side">
                  <button className="btn btn-primary btn-sm" onClick={() => primary(item)}>
                    {primaryLabel}
                  </button>
                  <details className="learner-menu">
                    <summary aria-label="⋯">⋯</summary>
                    <div className="learner-menu-pop">
                      <button onClick={() => menu(item, "snooze")}>{S.panel.menuSnooze}</button>
                      <button onClick={() => menu(item, "dismissed")}>{S.panel.menuDismiss}</button>
                      <button onClick={() => menu(item, "not_interested")}>{S.panel.menuNotInterested}</button>
                      {tooHardKinds.has(item.kind) && <button onClick={() => menu(item, "too_hard")}>{S.panel.menuTooHard}</button>}
                      {tooHardKinds.has(item.kind) && <button onClick={() => menu(item, "too_easy")}>{S.panel.menuTooEasy}</button>}
                    </div>
                  </details>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {tracksOpen && (
        <TracksDialog
          focusNative={tracksFocusNative}
          onClose={() => setTracksOpen(false)}
          onChanged={() => void requestRecommend()}
        />
      )}
      {dialog && dialog.kind === "self-explain" && (
        <SelfExplainDialog
          kpId={String((dialog.item.action as { payload?: Record<string, string | null> }).payload?.kpId || dialog.item.kpId || "")}
          kpName={String(dialog.item.facts.kpName ?? "")}
          relatedKpId={String((dialog.item.action as { payload?: Record<string, string | null> }).payload?.relatedKpId || "") || null}
          relatedName={String(dialog.item.facts.relatedName ?? "")}
          relationLabel={String(dialog.item.facts.relationLabel ?? "")}
          onClose={() => {
            setDialog(null);
            void learnerApi.feedback({ runId: state.runId, itemKey: dialog.item.key, kind: dialog.item.kind, libraryItemId: dialog.item.libraryItemId, action: "done" });
          }}
        />
      )}
      {dialog && dialog.kind === "unit-reader" && (
        <UnitReaderDialog
          unitId={String((dialog.item.action as { payload?: Record<string, string | null> }).payload?.unitId || dialog.item.unitId || "")}
          libraryItemId={dialog.item.libraryItemId}
          onClose={() => {
            setDialog(null);
            void learnerApi.feedback({ runId: state.runId, itemKey: dialog.item.key, kind: dialog.item.kind, libraryItemId: dialog.item.libraryItemId, action: "done" });
          }}
        />
      )}
      {dialog && dialog.kind === "context-reel" && (
        <ContextReelDialog
          lang={String((dialog.item.action as { payload?: Record<string, string | null> }).payload?.lang || "")}
          lexKey={String((dialog.item.action as { payload?: Record<string, string | null> }).payload?.key || "")}
          onClose={() => {
            setDialog(null);
            void learnerApi.feedback({ runId: state.runId, itemKey: dialog.item.key, kind: dialog.item.kind, libraryItemId: dialog.item.libraryItemId, action: "done" });
          }}
        />
      )}
      {dialog && dialog.kind === "sentence-mine" && (
        <SentenceMineDialog
          trackId={String((dialog.item.action as { payload?: Record<string, string | null> }).payload?.trackId || dialog.item.trackId || "")}
          onClose={() => {
            setDialog(null);
            void learnerApi.feedback({ runId: state.runId, itemKey: dialog.item.key, kind: dialog.item.kind, libraryItemId: dialog.item.libraryItemId, action: "done" });
          }}
        />
      )}
      {dialog && dialog.kind === "placement" && (
        <PlacementDialog
          lang={String((dialog.item.action as { payload?: Record<string, string | null> }).payload?.lang || "")}
          onClose={() => {
            setDialog(null);
            void learnerApi.feedback({ runId: state.runId, itemKey: dialog.item.key, kind: dialog.item.kind, libraryItemId: dialog.item.libraryItemId, action: "done" });
          }}
        />
      )}
    </section>
  );
}
