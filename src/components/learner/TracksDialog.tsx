// v48.80（D124 / 设计稿 §11.4）：学习轨道管理对话框。
// 上：我的轨道（改名 / mode / 语言或领域多选 / 状态 / 置顶 / 优先级 / 删除 / 展开归属材料）；
// 中：建议的轨道（采纳 = saveTrack source=proposal）；下：未归类的材料（归入… 多选勾选轨道 / 移出）；
// 底部：我的母语多选（保存时同时写 nativeConfirmed）+ 重建学习索引。
// 修订（2026-10-11，用户指令）：① 非 language 轨道的领域 = UDC 叶子芯片多选（至少保留一个，与主进程校验一致）；
// ② 「归入…」为多选菜单——已归属的轨道打勾，可一次勾选多条（逐条即时写覆盖，菜单收起后统一刷新），
//    勾选建议轨道 = 采纳并归入；无语言信息的轨道禁选 language 模式（主进程校验拒绝 lang 为空的 language 轨道）。
// 下拉一律用项目 Dropdown 组件（瑞士风直角 + 统一弹出动效），不用原生 select；
// focusNative=true 时才滚动到「我的母语」（面板母语入口用），常规打开不滚动。
import { useEffect, useMemo, useRef, useState } from "react";
import {
  learnerApi,
  learnerSettings,
  languageDisplayName,
  TRACK_MODES,
  type Track,
  type TrackMode,
  type TrackSummary,
} from "../../lib/learner";
import { learnerStrings } from "../../lib/learnerStrings";
import { udcLabel, UDC_LEAVES, UDC_OTHER } from "../../lib/udc";
import { useDialogA11y } from "../../lib/dialogA11y";
import Dropdown from "../Dropdown";
import NativeLangsPicker from "./NativeLangsPicker";

type ListResult = Awaited<ReturnType<typeof learnerApi.listTracks>>;

export default function TracksDialog({ onClose, onChanged, focusNative }: { onClose: () => void; onChanged?: () => void; focusNative?: boolean }) {
  const S = learnerStrings();
  const ref = useDialogA11y<HTMLDivElement>(onClose);
  const [data, setData] = useState<ListResult | null>(null);
  const [nativeLangs, setNativeLangs] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string>("");
  const [busy, setBusy] = useState(false);
  /** 领域多选草稿（trackId → codes）：写入即时生效的本地乐观态，reload 后清除（防连点被旧值回滚） */
  const [udcDraft, setUdcDraft] = useState<Record<string, string[]>>({});
  /** 「归入…」会话内勾选态（itemId → option value 列表）；菜单收起时统一刷新后清除 */
  const [assignSel, setAssignSel] = useState<Record<string, string[]>>({});
  /** 本次会话里由建议轨道采纳而来的 proposalKey → 新轨道 id（供取消勾选用） */
  const adoptedRef = useRef<Record<string, string>>({});
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
    // 仅面板「更改母语」入口要求滚到「我的母语」；常规打开保持从顶部开始
    if (!focusNative) return;
    const t = window.setTimeout(() => nativeRef.current?.scrollIntoView({ block: "center" }), 80);
    return () => window.clearTimeout(t);
  }, [focusNative]);

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
      setUdcDraft((prev) => {
        if (!(t.id in prev)) return prev;
        const next = { ...prev };
        delete next[t.id];
        return next;
      });
    } finally {
      setBusy(false);
    }
  }

  /** 采纳建议轨道（只保存不刷新）；「建议的轨道」区的采纳按钮用带刷新的 adopt */
  async function adoptCore(key: string): Promise<Track | null> {
    const p = proposals.find((x) => x.key === key);
    if (!p) return null;
    const r = await learnerApi.saveTrack({
      label: p.label,
      mode: p.mode,
      lang: p.lang,
      udcCodes: p.udcCodes,
      status: "active",
      pinned: false,
      priority: 3,
      source: "proposal"
    });
    return r.track || null;
  }

  async function adopt(key: string) {
    setBusy(true);
    try {
      const track = await adoptCore(key);
      await reload();
      onChanged?.();
      return track;
    } finally {
      setBusy(false);
    }
  }

  // 每本书已归属的轨道（含自动归属；主进程对每条轨道都判定，同属多轨全部记录）
  const materialMemberships = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const x of data?.trackMaterials || []) {
      const list = map.get(x.libraryItemId) || [];
      list.push(`track:${x.trackId}`);
      map.set(x.libraryItemId, list);
    }
    return map;
  }, [data]);

  function membershipsOf(itemId: string): string[] {
    return assignSel[itemId] ?? (materialMemberships.get(itemId) || []);
  }

  /** 归入选单勾选：用户轨道勾选 = member=1、取消 = member=0（与展开区「移出」同口径）；
      建议轨道勾选 = 采纳并归入，取消 = 从新轨道移出。会话内只改本地勾选态，收起时统一刷新。 */
  async function toggleAssign(itemId: string, optionValue: string) {
    const checked = membershipsOf(itemId).includes(optionValue);
    const next = checked ? membershipsOf(itemId).filter((v) => v !== optionValue) : [...membershipsOf(itemId), optionValue];
    setAssignSel((prev) => ({ ...prev, [itemId]: next }));
    setBusy(true);
    try {
      if (optionValue.startsWith("track:")) {
        await learnerApi.setTrackMaterial(optionValue.slice(6), itemId, checked ? 0 : 1);
      } else if (optionValue.startsWith("proposal:")) {
        const key = optionValue.slice(9);
        if (checked) {
          const trackId = adoptedRef.current[key];
          if (trackId) await learnerApi.setTrackMaterial(trackId, itemId, 0);
        } else {
          const track = await adoptCore(key);
          if (track) {
            adoptedRef.current[key] = track.id;
            await learnerApi.setTrackMaterial(track.id, itemId, 1);
          }
        }
      }
    } finally {
      setBusy(false);
    }
  }

  /** 归入选单收起：有过勾选才刷新（未归类的材料重新计算，已归入的行随之离开列表） */
  function closeAssign() {
    if (Object.keys(assignSel).length === 0) return;
    void reload().then(() => setAssignSel({}));
    onChanged?.();
  }

  function assignOptions(): { value: string; label: string }[] {
    const opts: { value: string; label: string }[] = [];
    for (const t of myTracks) opts.push({ value: `track:${t.id}`, label: t.label });
    for (const p of proposals) opts.push({ value: `proposal:${p.key}`, label: `${p.label}（${S.tracks.proposalTag}）` });
    return opts;
  }

  async function saveNativeLangs(next: string[]) {
    setNativeLangs(next);
    await learnerSettings.write({ nativeLangs: next, nativeConfirmed: true });
    await reload();
    onChanged?.();
  }

  function modeOptions(t: TrackSummary) {
    return TRACK_MODES.map((m) => ({
      value: m,
      // language 轨道必须有语言（主进程校验拒绝）；无语言信息的轨道禁选并注明
      label: m === "language" && !t.lang ? `${S.tracks.modeNames[m]}（${S.tracks.modeLangUnavailable}）` : S.tracks.modeNames[m],
      disabled: m === "language" && !t.lang
    }));
  }

  function changeMode(t: TrackSummary, m: string) {
    if (m === "language") {
      // 转为语言习得：领域编码必须清空（主进程校验）；lang 保留原值
      void patchTrack(t, { mode: "language", udcCodes: [] });
    } else {
      // 转为领域轨道：领域为空（语言轨道转出）时默认「其他」，可在下方多选里改
      const current = udcDraft[t.id] ?? t.udcCodes;
      const codes = current.length > 0 ? current : [UDC_OTHER];
      void patchTrack(t, { mode: m as TrackMode, udcCodes: codes });
    }
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
            <button
              className="btn-link"
              onClick={() => void learnerApi.saveTrack({ label: S.tracks.trackNamePlaceholder, mode: "concept", udcCodes: ["other"] }).then(() => reload().then(() => onChanged?.()))}
            >
              ＋{S.tracks.addTrack}
            </button>
          </h4>
          {myTracks.length === 0 && <p className="learner-empty">{S.tracks.tracksEmptyHint}</p>}
          {myTracks.map((t) => {
            const udcNow = udcDraft[t.id] ?? t.udcCodes;
            return (
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
                  <Dropdown
                    value={t.mode}
                    title={S.tracks.modeLabel}
                    align="left"
                    options={modeOptions(t)}
                    onChange={(m) => changeMode(t, m)}
                  />
                  <label className="learner-track-check">
                    <input type="checkbox" checked={t.status !== "paused"} onChange={(e) => void patchTrack(t, { status: e.target.checked ? "active" : "paused" })} />
                    <span>{t.status !== "paused" ? S.tracks.statusActive : S.tracks.statusPaused}</span>
                  </label>
                  <label className="learner-track-check">
                    <input type="checkbox" checked={t.pinned} onChange={(e) => void patchTrack(t, { pinned: e.target.checked })} />
                    <span>{S.tracks.pinnedLabel}</span>
                  </label>
                  <Dropdown
                    value={String(t.priority)}
                    title={S.tracks.priorityLabel}
                    align="left"
                    options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${S.tracks.priorityLabel} ${n}` }))}
                    onChange={(n) => void patchTrack(t, { priority: Number(n) })}
                  />
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
                  <div className="learner-track-sub learner-udc-edit">
                    <span>{S.tracks.udcLabel}</span>
                    <UdcPicker
                      value={udcNow}
                      onToggle={(code) => {
                        // 至少保留一个领域（主进程校验拒绝空 udcCodes），最后一个选中项不可取消
                        const next = udcNow.includes(code) ? udcNow.filter((c) => c !== code) : [...udcNow, code];
                        if (next.length === 0) return;
                        setUdcDraft((prev) => ({ ...prev, [t.id]: next }));
                        void patchTrack(t, { udcCodes: next });
                      }}
                    />
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
            );
          })}

          <h4>{S.tracks.proposals}</h4>
          {proposals.length === 0 && <p className="learner-empty">{S.tracks.proposalsEmptyHint}</p>}
          {proposals.map((p) => (
            <div className="learner-assign-row" key={p.key}>
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
            <div className="learner-assign-row" key={m.libraryItemId}>
              <span className="learner-assign-title" dir="auto">
                {m.title}
                {!m.lang && <span className="learner-track-sub"> · {S.tracks.unknownLangHint}</span>}
              </span>
              <Dropdown
                multiple
                value=""
                placeholder={S.tracks.assignTo}
                title={S.tracks.assignTo}
                align="left"
                options={assignOptions()}
                selectedValues={membershipsOf(m.libraryItemId)}
                onToggle={(v) => void toggleAssign(m.libraryItemId, v)}
                onClose={closeAssign}
              />
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
            {S.tracks.done}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 领域多选（设计稿 §11.4「其他显示 UDC 叶子多选」）：UDC 叶子 + 其他，learner-tag 芯片（与母语多选同一控件语言） */
function UdcPicker({ value, onToggle }: { value: string[]; onToggle: (code: string) => void }) {
  const codes = [...UDC_LEAVES.map((l) => l.code), UDC_OTHER];
  const selected = new Set(value);
  return (
    <div className="learner-native-list">
      {codes.map((code) => (
        <button
          key={code}
          type="button"
          className={`learner-tag${selected.has(code) ? " is-on" : ""}`}
          aria-pressed={selected.has(code)}
          onClick={() => onToggle(code)}
        >
          {udcLabel(code)}
        </button>
      ))}
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
        <div className="learner-assign-row" key={m.libraryItemId}>
          <span className="learner-assign-title" dir="auto">
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
