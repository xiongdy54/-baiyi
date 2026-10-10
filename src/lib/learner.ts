// v48.80（D124 / 设计稿 §11.2/§11.6）：学习者模型渲染层类型 + API 封装 + 设置读写。
// window.learnerAPI 不存在（浏览器预览）时返回空结果，不抛错。
import { settingsStore } from "./settings";
import { eventBus } from "./eventbus";
import { learnerLocale } from "./learnerStrings";

export type TrackMode = "language" | "concept" | "procedural" | "factual" | "narrative";
export const TRACK_MODES: TrackMode[] = ["language", "concept", "procedural", "factual", "narrative"];

/** 推荐种类（封闭枚举 13 个，编号 K1–K12、K14；K13 预留不实现，设计稿 §8.1） */
export type RecKind =
  | "continue"
  | "start"
  | "extract-batch"
  | "extract-to-card"
  | "reinforce"
  | "cross-material"
  | "self-explain"
  | "practice"
  | "find-material"
  | "reread"
  | "context-reel"
  | "sentence-mine"
  | "placement";

export type RecAction =
  | { type: "open-book"; libraryItemId: string; hintUnitTitle?: string }
  | { type: "jump"; documentId: string; anchor: { anchorText: string; anchorRatio?: number; pageIndex?: number; cfi?: string } }
  | { type: "review"; scopeKpIds: string[]; title?: string }
  | { type: "extract-session"; bookItemIds: string[]; title?: string }
  | { type: "copy-query"; text: string }
  | { type: "dialog"; dialog: "self-explain" | "unit-reader" | "context-reel" | "sentence-mine" | "placement"; payload: Record<string, string | null> };

export type RecItem = {
  key: string;
  kind: RecKind;
  trackId: string;
  trackLabel: string;
  libraryItemId?: string;
  unitId?: string;
  kpId?: string;
  extractIds?: string[];
  title: string;
  reason: string;
  score: number;
  facts: Record<string, string | number>;
  action: RecAction;
};

export type TrackStatus = "active" | "paused" | "archived";
export type Track = {
  id: string;
  label: string;
  mode: TrackMode;
  lang: string;
  udcCodes: string[];
  status: TrackStatus;
  pinned: boolean;
  priority: number;
  source: "user" | "proposal";
};
export type TrackProposal = { key: string; label: string; mode: TrackMode; lang: string; udcCodes: string[] };
export type TrackSummary = Track & {
  isProposal: boolean;
  weight: number;
  materialCount: number;
  kpCount: number;
  levelCounts: [number, number, number, number, number];
};

export type LearnerStatus = {
  enabled?: boolean;
  indexing?: boolean;
  phase?: string;
  done?: number;
  total?: number;
  lastRefreshAt?: number;
  lastError?: string;
};

export type RecommendResult = {
  ok: boolean;
  disabled?: boolean;
  indexing?: boolean;
  runId: string | null;
  generatedAt: number | null;
  items: RecItem[];
  candidateCount: number;
  tracks: TrackSummary[];
  usingProposals: boolean;
  error?: string;
};

export type KpLevelRow = {
  kpId: string;
  level: number;
  label: string;
  confidence: string;
  fading: boolean;
  metrics: Record<string, unknown>;
};

export type PlacementBand = { from: number; to: number; words: { key: string; sample: string }[] };

/** learnerAPI 封装（通道名与 electron/preload.js 一一对应；API 缺席时空结果，便于浏览器预览） */
export const learnerApi = {
  async status(): Promise<LearnerStatus> {
    return (window.learnerAPI ? ((await window.learnerAPI.status()) as LearnerStatus) : { enabled: false });
  },
  async refresh(force = false): Promise<{ ok: boolean; disabled?: boolean; ms?: number; error?: string }> {
    if (!window.learnerAPI) return { ok: false };
    return (await window.learnerAPI.refresh({ force })) as { ok: boolean; disabled?: boolean; ms?: number; error?: string };
  },
  async recommend(force = false): Promise<RecommendResult> {
    if (!window.learnerAPI) {
      return { ok: true, indexing: false, runId: null, generatedAt: null, items: [], candidateCount: 0, tracks: [], usingProposals: false };
    }
    return (await window.learnerAPI.recommend({ force })) as RecommendResult;
  },
  async feedback(payload: { runId?: string | null; itemKey: string; kind: string; libraryItemId?: string; action: string }): Promise<{ ok: boolean; disabled?: boolean }> {
    if (!window.learnerAPI) return { ok: false };
    return (await window.learnerAPI.feedback(payload as Record<string, unknown>)) as { ok: boolean; disabled?: boolean };
  },
  async listTracks(): Promise<{
    ok?: boolean;
    disabled?: boolean;
    tracks: TrackSummary[];
    proposals: TrackProposal[];
    unassigned: { libraryItemId: string; title: string; lang?: string }[];
    trackMaterials?: { trackId: string; libraryItemId: string; title: string; lang: string }[];
  }> {
    if (!window.learnerAPI) return { tracks: [], proposals: [], unassigned: [] };
    return (await window.learnerAPI.listTracks()) as {
      tracks: TrackSummary[];
      proposals: TrackProposal[];
      unassigned: { libraryItemId: string; title: string; lang?: string }[];
      trackMaterials?: { trackId: string; libraryItemId: string; title: string; lang: string }[];
    };
  },
  async saveTrack(track: Partial<Track>): Promise<{ ok: boolean; disabled?: boolean; error?: string; track?: Track }> {
    if (!window.learnerAPI) return { ok: false };
    return (await window.learnerAPI.saveTrack(track)) as { ok: boolean; disabled?: boolean; error?: string; track?: Track };
  },
  async deleteTrack(id: string): Promise<{ ok: boolean; disabled?: boolean }> {
    if (!window.learnerAPI) return { ok: false };
    return (await window.learnerAPI.deleteTrack(id)) as { ok: boolean; disabled?: boolean };
  },
  async setTrackMaterial(trackId: string, libraryItemId: string, member: 0 | 1 | null): Promise<{ ok: boolean; disabled?: boolean }> {
    if (!window.learnerAPI) return { ok: false };
    return (await window.learnerAPI.setTrackMaterial({ trackId, libraryItemId, member })) as { ok: boolean; disabled?: boolean };
  },
  async kpLevels(kpIds?: string[]): Promise<{ ok?: boolean; disabled?: boolean; rows?: KpLevelRow[] }> {
    if (!window.learnerAPI) return { disabled: true };
    return (await window.learnerAPI.kpLevels(kpIds ? { kpIds } : {})) as { rows?: KpLevelRow[] };
  },
  async logEvent(evt: { kind: string; lang?: string; libraryItemId?: string; unitId?: string; kpId?: string; payload?: Record<string, unknown> }): Promise<{ ok: boolean; disabled?: boolean; error?: string }> {
    if (!window.learnerAPI) return { ok: false };
    return (await window.learnerAPI.logEvent(evt as Record<string, unknown>)) as { ok: boolean; disabled?: boolean; error?: string };
  },
  async unitText(unitId: string): Promise<{ unitId: string; title: string; material: string; text: string; lang: string; learningSpans: [number, number][]; documentId: string; anchor: { anchorText: string; anchorRatio?: number; pageIndex?: number } } | null> {
    if (!window.learnerAPI) return null;
    return (await window.learnerAPI.unitText({ unitId })) as {
      unitId: string;
      title: string;
      material: string;
      text: string;
      lang: string;
      learningSpans: [number, number][];
      documentId: string;
      anchor: { anchorText: string; anchorRatio?: number; pageIndex?: number };
    } | null;
  },
  async contextReel(lang: string, key: string): Promise<{ word: string; sentences: { text: string; start: number; end: number; unitId: string; material: string; documentId: string; anchor: { anchorText: string; anchorRatio?: number; pageIndex?: number } }[] } | null> {
    if (!window.learnerAPI) return null;
    return (await window.learnerAPI.contextReel({ lang, key })) as {
      word: string;
      sentences: { text: string; start: number; end: number; unitId: string; material: string; documentId: string; anchor: { anchorText: string; anchorRatio?: number; pageIndex?: number } }[];
    } | null;
  },
  async sentenceMine(trackId: string, limit = 10): Promise<{ items: { sentence: string; target: { key: string; sample: string; start: number; end: number }; unitId: string; material: string; documentId: string; anchor: { anchorText: string; anchorRatio?: number; pageIndex?: number } }[] } | null> {
    if (!window.learnerAPI) return null;
    return (await window.learnerAPI.sentenceMine({ trackId, limit })) as {
      items: { sentence: string; target: { key: string; sample: string; start: number; end: number }; unitId: string; material: string; documentId: string; anchor: { anchorText: string; anchorRatio?: number; pageIndex?: number } }[];
    } | null;
  },
  async placementSample(lang: string): Promise<{ bands: PlacementBand[] } | null> {
    if (!window.learnerAPI) return null;
    return (await window.learnerAPI.placementSample({ lang })) as { bands: PlacementBand[] } | null;
  },
  async lexStats(lang: string): Promise<{ knownCount: number; familiarCount: number; learningCount: number; totalLexemes: number; recentCoverage: number | null } | null> {
    if (!window.learnerAPI) return null;
    return (await window.learnerAPI.lexStats({ lang })) as { knownCount: number; familiarCount: number; learningCount: number; totalLexemes: number; recentCoverage: number | null } | null;
  },
  async rebuild(): Promise<{ ok: boolean; disabled?: boolean; ms?: number; error?: string }> {
    if (!window.learnerAPI) return { ok: false };
    return (await window.learnerAPI.rebuild()) as { ok: boolean; disabled?: boolean; ms?: number; error?: string };
  }
};

// ---------- 设置（设计稿 §11.6；存储形态照 app.extracts 先例） ----------

export type LearnerSettingsShape = {
  enabled: boolean;
  nativeLangs: string[] | null; // null = 字段缺省（用户尚未确认）
  nativeConfirmed: boolean;
  recCount: number;
  /** 母语生效值：合法且非空用它，否则回落系统区域语言，再取不到为 [] */
  effectiveNativeLangs: string[];
};

/** ISO 639-1 主子标签（zh-TW → zh；与主进程 learnerRefresh 同口径） */
export function baseLang(tag: string): string {
  return String(tag ?? "")
    .toLowerCase()
    .split(/[-_]/)[0];
}

function systemLocaleLang(): string {
  try {
    return baseLang(navigator.language || "");
  } catch {
    return "";
  }
}

function normalizeLayer(layer: unknown) {
  const l = layer && typeof layer === "object" ? (layer as Record<string, unknown>) : {};
  const enabled = l.enabled !== false;
  let nativeLangs: string[] | null = null;
  if (Array.isArray(l.nativeLangs)) {
    nativeLangs = [...new Set(l.nativeLangs.map((x) => baseLang(String(x))).filter((x) => /^[a-z]{2,3}$/.test(x)))];
  }
  const recCount = Math.min(10, Math.max(3, Math.round(Number(l.recCount) || 6)));
  const sys = systemLocaleLang();
  const effectiveNativeLangs = nativeLangs && nativeLangs.length > 0 ? nativeLangs : /^[a-z]{2,3}$/.test(sys) ? [sys] : [];
  return { enabled, nativeLangs, nativeConfirmed: l.nativeConfirmed === true, recCount, effectiveNativeLangs };
}

export const learnerSettings = {
  async read(): Promise<LearnerSettingsShape> {
    const layer = await settingsStore.get<unknown>("app", "learner", {});
    return normalizeLayer(layer);
  },
  async write(patch: Partial<{ enabled: boolean; nativeLangs: string[]; nativeConfirmed: boolean; recCount: number }>): Promise<void> {
    const layer = await settingsStore.get<Record<string, unknown>>("app", "learner", {});
    const next = { ...(layer && typeof layer === "object" ? layer : {}), ...patch };
    await settingsStore.set("app", "learner", next);
    eventBus.emit("settings/changed", { scope: "app", key: "learner" });
  }
};

/** 母语选择候选（设计稿 §11.6；显示名用 Intl.DisplayNames 按界面语言生成，不维护语言名表） */
export const NATIVE_LANG_CHOICES = [
  "en", "zh", "es", "hi", "ar", "pt", "bn", "ru", "ja", "de", "fr", "ko", "it", "tr", "vi", "pl", "uk",
  "nl", "th", "id", "ms", "fa", "he", "el", "cs", "sv", "ro", "hu", "da", "fi", "no", "sk", "bg", "hr",
  "sr", "lt", "lv", "et", "sl", "ca", "sw", "tl", "ta", "te", "ur", "mr"
];

const displayNamesCache = new Map<string, Intl.DisplayNames>();
export function languageDisplayName(code: string): string {
  try {
    const locale = learnerLocale();
    let dn = displayNamesCache.get(locale);
    if (!dn) {
      dn = new Intl.DisplayNames([locale], { type: "language" });
      displayNamesCache.set(locale, dn);
    }
    return dn.of(code) || code;
  } catch {
    return code;
  }
}

// window 全局类型声明（preload learnerAPI）
declare global {
  interface Window {
    learnerAPI?: {
      status: () => Promise<unknown>;
      refresh: (opts: { force?: boolean }) => Promise<unknown>;
      recommend: (opts: { force?: boolean }) => Promise<unknown>;
      feedback: (payload: Record<string, unknown>) => Promise<unknown>;
      listTracks: () => Promise<unknown>;
      saveTrack: (track: Partial<Track>) => Promise<unknown>;
      deleteTrack: (id: string) => Promise<unknown>;
      setTrackMaterial: (payload: { trackId: string; libraryItemId: string; member: 0 | 1 | null }) => Promise<unknown>;
      kpLevels: (opts: { kpIds?: string[] }) => Promise<unknown>;
      logEvent: (evt: Record<string, unknown>) => Promise<unknown>;
      unitText: (opts: { unitId: string }) => Promise<unknown>;
      contextReel: (opts: { lang: string; key: string }) => Promise<unknown>;
      sentenceMine: (opts: { trackId: string; limit?: number }) => Promise<unknown>;
      placementSample: (opts: { lang: string }) => Promise<unknown>;
      lexStats: (opts: { lang: string }) => Promise<unknown>;
      rebuild: () => Promise<unknown>;
    };
  }
}
