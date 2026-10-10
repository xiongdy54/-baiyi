// v48.80（D124 / 设计稿 §11.4）：学习轨道管理对话框。
// 上：我的轨道（改名 / mode / 语言或领域 / 状态 / 置顶 / 优先级 / 删除 / 展开归属材料）；
// 中：建议的轨道（采纳 = saveTrack source=proposal）；下：未归类的材料（归入… / 移出）；
// 底部：我的母语多选（保存时同时写 nativeConfirmed）+ 重建学习索引。
import { useEffect, useMemo, useRef, useState } from "react";
import {
  learnerApi,
  learnerSettings,
  TRACK_MODES,
  type Track,
  type TrackMode,
  type TrackSummary,
} from "../../lib/learner";
import { learnerStrings } from "../../lib/learnerStrings";
import { udcLabel, UDC_LEAVES } from "../../lib/udc";
import { languageDisplayName } from "../../lib/learner";
import { useDialogA11y } from "../../lib/dialogA11y";
import NativeLangsPicker from "./NativeLangsPicker";

type ListResult = Awaited<ReturnType<typeof learnerApi.listTracks>>;

export default function TracksDialog({ onClose, onChanged }: { onClose: () => void; onChanged?: () => void }) {
  const S = learnerStrings();
  const ref = useDialogA11y<HTMLDivElement>(onClose);
  const [data, setData] = useState<ListResult | null>(null);
  const [nativeLangs, setNativeLangs] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const nativeRef = useRef<HTMLDivElement>(null);

  async function reload() {
    const r = await learnerApi.listTracks();
    setData(r);
    const s = await learnerSettings.read();
    setNativeLangs(s.effectiveNativeLangs);
  }
  useEffect(() => {
    void reload();
  }, []);

  useEffect(() => {
    // 面板「更改母语」入口会要求滚到「我的母语」
    const t = window.setTimeout(() => nativeRef.current?.scrollIntoView({ block: "nearest" }), 50);
    return () => window.clearTimeout(t);
  }, []);

  const myTracks = useMemo(() => (data?.tracks || []).filter((t) => !t.isProposal), [data]);
  const proposals = useMemo(() => data?.proposals || [], [data]);
  const unassigned = useMemo(() => data?.unassigned || [], [data]);

  async function patchTrack(t: TrackSummary, patch: Partial<Track>) {
    setBusy(true);
    try {
      await learnerApi.saveTrack({
        id: t.id,
        label: t.label,
        mode: t.mode,
        lang: t.lang,
        udcCodes: t.udcCodes,
        status: t.status,
        pinned: t.pinned,
        priority: t.priority,
        source: t.source,
        ...patch
      });
      await reload();
      onChanged?.();
    } finally {
      setBusy(false);
    }
  }

  async function adopt(key: string) {
    const p = proposals.find((x) => x.key === key);
    if (!p) return;
    setBusy(true);
    try {
      await learnerApi.saveTrack({
        label: p.label,
        mode: p.mode,
        lang: p.lang,
        udcCodes: p.udcCodes,
        status: "active",
        pinned: false,
        priority: 3,
        source: "proposal"
      });
      await reload();
      onChanged?.();
    } finally {
      setBusy(false);
    }
  }

  async function saveNativeLangs(next: string[]) {
    setNativeLangs(next);
    await learnerSettings.write({ nativeLangs: next, nativeConfirmed: true });
    await reload();
    onChanged?.();
  }

  return (
    <div className="modal-backdrop" data-show="in" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-panel modal-panel-wide" ref={ref} role="dialog" aria-modal="true" aria-label={S.tracks.dialogTitle}>
        <div className="modal-header">
          <h3>{S.tracks.dialogTitle}</h3>
          <button className="icon-btn" aria-label="close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-scroll learner-dialog-body">
          <h4>
            {S.tracks.myTracks}
            <button className="btn-link" onClick={() => void learnerApi.saveTrack({ label: S.tracks.trackNamePlaceholder, mode: "concept", udcCodes: ["other"] }).then(() => reload().then(() => onChanged?.()))}>
              ＋{S.tracks.addTrack}
            </button>
          </h4>
          {myTracks.length === 0 && <p className="learner-empty">{S.panel.empty}</p>}
          {myTracks.map((t) => (
            <div className="learner-track" key={t.id}>
              <div className="learner-track-row">
                <input
                  className="learner-track-name"
                  defaultValue={t.label}
                  aria-label={S.tracks.nameLabel}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== t.label) void patchTrack(t, { label: v.slice(0, 40) });
                  }}
                />
                <select
                  className="learner-count-select"
                  value={t.mode}
                  aria-label={S.tracks.modeLabel}
                  onChange={(e) => void patchTrack(t, { mode: e.target.value as TrackMode })}
                >
                  {TRACK_MODES.map((m) => (
                    <option key={m} value={m}>
                      {S.tracks.modeNames[m]}
                    </option>
                  ))}
                </select>
                <label className="learner-track-check">
                  <input type="checkbox" checked={t.status !== "paused"} onChange={(e) => void patchTrack(t, { status: e.target.checked ? "active" : "paused" })} />
                  <span>{t.status !== "paused" ? S.tracks.statusActive : S.tracks.statusPaused}</span>
                </label>
                <label className="learner-track-check">
                  <input type="checkbox" checked={t.pinned} onChange={(e) => void patchTrack(t, { pinned: e.target.checked })} />
                  <span>{S.tracks.pinnedLabel}</span>
                </label>
                <select
                  className="learner-count-select"
                  value={t.priority}
                  aria-label={S.tracks.priorityLabel}
                  onChange={(e) => void patchTrack(t, { priority: Number(e.target.value) })}
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {S.tracks.priorityLabel} {n}
                    </option>
                  ))}
                </select>
                <button
                  className="btn-link learner-danger"
                  onClick={() => {
                    if (window.confirm(S.tracks.confirmDelete)) void learnerApi.deleteTrack(t.id).then(() => reload().then(() => onChanged?.()));
                  }}
                >
                  {S.tracks.delete}
                </button>
              </div>
              {t.mode === "language" ? (
                <div className="learner-track-sub">
                  {S.tracks.langLabel}: <strong dir="auto">{t.lang ? languageDisplayName(t.lang) : S.tracks.unknownLangHint}</strong>
                </div>
              ) : (
                <div className="learner-track-sub">
                  {S.tracks.udcLabel}:{" "}
                  {UDC_LEAVES.filter((l) => t.udcCodes.includes(l.code)).map((l) => udcLabel(l.code)).join("、") || "—"}
                </div>
              )}
              <div className="learner-track-sub">
                <button className="btn-link" onClick={() => setExpanded(expanded === t.id ? "" : t.id)}>
                  {S.tracks.expandMaterials}（{S.tracks.materialsCount(t.materialCount)}）
                </button>
              </div>
              {expanded === t.id && (
                <TrackMaterials
                  materials={(data?.trackMaterials || []).filter((x) => x.trackId === t.id)}
                  onRemove={(libraryItemId) => {
                    void learnerApi.setTrackMaterial(t.id, libraryItemId, 0).then(() => reload().then(() => onChanged?.()));
                  }}
                />
              )}
            </div>
          ))}

          <h4>{S.tracks.proposals}</h4>
          {proposals.length === 0 && <p className="learner-empty">—</p>}
          {proposals.map((p) => (
            <div className="learner-track-row" key={p.key}>
              <span className="learner-item-title" dir="auto">
                {p.label}
              </span>
              <span className="learner-track-sub">{S.tracks.modeNames[p.mode]}</span>
              <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void adopt(p.key)}>
                {S.tracks.adopt}
              </button>
            </div>
          ))}

          <h4>{S.tracks.unassigned}</h4>
          {unassigned.length === 0 && <p className="learner-empty">—</p>}
          {unassigned.map((m) => (
            <div className="learner-track-row" key={m.libraryItemId}>
              <span className="learner-item-title" dir="auto">
                {m.title}
                {!m.lang && <span className="learner-track-sub"> · {S.tracks.unknownLangHint}</span>}
              </span>
              <select
                className="learner-count-select"
                value=""
                aria-label={S.tracks.assignTo}
                onChange={(e) => {
                  const trackId = e.target.value;
                  if (!trackId) return;
                  void learnerApi.setTrackMaterial(trackId, m.libraryItemId, 1).then(() => reload().then(() => onChanged?.()));
                }}
              >
                <option value="">{S.tracks.assignTo}</option>
                {myTracks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          ))}

          <div id="sec-learner-native" ref={nativeRef}>
            <h4>{S.tracks.nativeLangs}</h4>
            <p className="learner-track-sub">{S.tracks.nativeLangsHint}</p>
            <NativeLangsPicker value={nativeLangs} onChange={(next) => void saveNativeLangs(next)} />
          </div>
        </div>
        <div className="learner-dialog-footer">
          <button
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void learnerApi
                .rebuild()
                .finally(() => {
                  setBusy(false);
                  onChanged?.();
                });
            }}
          >
            {busy ? S.tracks.rebuilding : S.tracks.rebuild}
          </button>
          <button className="btn btn-primary" onClick={onClose}>
            {S.tracks.saved}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 归属材料列表（轨道展开区）：每本后「移出」（member=0 排除覆盖，设计稿 §11.4） */
function TrackMaterials({
  materials,
  onRemove,
}: {
  materials: { trackId: string; libraryItemId: string; title: string; lang: string }[];
  onRemove: (libraryItemId: string) => void;
}) {
  const S = learnerStrings();
  if (materials.length === 0) return <p className="learner-empty">—</p>;
  return (
    <>
      {materials.map((m) => (
        <div className="learner-track-row" key={m.libraryItemId}>
          <span className="learner-item-title" dir="auto">
            {m.title}
          </span>
          <button className="btn-link" onClick={() => onRemove(m.libraryItemId)}>
            {S.tracks.remove}
          </button>
        </div>
      ))}
    </>
  );
}
