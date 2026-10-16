import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { SKINS } from "../skins";
import { aiGateway, aiConfigUsable, type AIConfig, type AiPresetMeta, type LocalDetectResult } from "../lib/ai";
import { settingsStore } from "../lib/settings";
import {
  DEFAULT_ANNOTATE_MODE,
  DEFAULT_ANNOTATE_FORM,
  DEFAULT_ANNOTATE_PALETTE,
  DEFAULT_ANNOTATION_FILTER,
  ANNOT_PALETTE_MAX,
  readAnnotationSettings,
  writeAnnotationSetting,
  type AnnotationSettings
} from "../lib/annotationSettings";
import { ANNOT_COLORS } from "./SelectionMenu";
import {
  readExtractCardSettings,
  DEFAULT_EXTRACT_EDITOR_TOOLBAR,
  DEFAULT_EXTRACT_EDITOR_TOOLBAR_FLOAT,
  DEFAULT_EXTRACT_EDITOR_TOOLBAR_TOP,
  DEFAULT_EXTRACT_FACE_FONT_FOLLOW,
  DEFAULT_EXTRACT_FACE_FONT_SIZE,
  DEFAULT_EXTRACT_FACE_FONT_FAMILY,
  type ExtractCardSettings
} from "../lib/extractCardSettings";
import { DEFAULT_SELECTION_BAR_STYLE, normalizeSelectionBarStyle, type SelectionBarStyle } from "../lib/selectionBarSettings";
import { shortcutsApi, type ShortcutStatus } from "../lib/journal";
import { normalizePlacement, type WorkbenchPlacement } from "../lib/workbenchLayout";
import { commandRegistry, eventToCombo, type CommandDef } from "../lib/commands";
import { WIDGETS } from "./dashboard/widgets";
import Dropdown from "./Dropdown";
import { normalizeReaderSettings, type CustomThemeEntry, type ReaderSettings } from "../lib/reader/service";
import type { DashLayoutV2, WidgetSize } from "./dashboard/layout";
import { DICT_CATALOG, type DictCatalogItem } from "../lib/dictCatalog";
import { DEFAULT_POPUP_FIELDS } from "../lib/dictClient";
import { FIELD_LABELS } from "./DictPanel";
import { eventBus } from "../lib/eventbus";
// v48.114（D159）：`import { memoryApi, ... } from "../lib/memory"` 随 MemorySection 摘除（lib/memory.ts 保留）
import { useDialogA11y } from "../lib/dialogA11y";
import { useDismiss } from "../lib/useDismiss";
import SettingsInfo from "./SettingsInfo";
// v48.80（D124 / 设计稿 §11.6）：学习者知识模型设置子块（sec-learner）
import { learnerApi, learnerSettings } from "../lib/learner";
import { learnerStrings as learnerStringsSafe } from "../lib/learnerStrings";
import NativeLangsPicker from "./learner/NativeLangsPicker";
import TracksDialog from "./learner/TracksDialog";
// v48.22（D58 §6.8）：摘录复习开关 / 每日上限（写路径经主进程硬边界校验）
import {
  extractSettings,
  fetchLimitsState,
  validateLimits,
  EXTRACT_ENGINE_LABEL,
  type Limits,
  type LimitsState,
  type InterleaveMode
} from "../lib/sessionQueue";
import { rerankExtractsNow, readMultiSelectKey, MULTI_SELECT_KEYS, DEFAULT_MULTI_SELECT_KEY, type ExtractEngine, type MultiSelectKey } from "../lib/readingWorkflow";
// v49.8（D182）：界面语言——语言切换区块（sec-language，唯一切换入口）
import { LANGUAGES, getLocale, setLocale, normalizeLocale, useT, type Locale } from "../lib/i18n";

export type ThemeMode = "light" | "dark";

interface Props {
  theme: ThemeMode;
  onThemeChange: (m: ThemeMode) => void;
  skinId: string;
  onSkinChange: (id: string) => void;
  accentColor: string;
  onAccentChange: (color: string) => void;
  /** v49.0 / D170：应用内动效等级（跟随系统 / 关闭动画） */
  motionSetting: "system" | "off";
  onMotionChange: (v: "system" | "off") => void;
  onClose: () => void;
}

// 供应商注册表经 ai:getConfig 下发（v48.68 / D112，主进程 PRESETS 单一来源）；
// 此静态表仅为「主进程未下发 presets 字段」时的兜底（异常降级 / 桩测试），常规路径不使用
const FALLBACK_PRESETS: AiPresetMeta[] = [
  { id: "goat", name: "Command Code GOAT Plan", group: "official", baseUrl: "", model: "", keyUrl: "", hint: "api.commandcode.ai/provider/v1 · 默认模型 z-ai/glm-5.3-flash" },
  { id: "zai", name: "智谱官方 API（bigmodel.cn）", group: "official", baseUrl: "", model: "", keyUrl: "", hint: "open.bigmodel.cn · 默认免费模型 glm-4.7-flash" },
  { id: "local", name: "本地模型（Ollama / LM Studio）", group: "local", baseUrl: "", model: "", keyUrl: "", hint: "零排队零成本 · 8GB 显存推荐 qwen3:8b" },
  { id: "custom", name: "通用 API Key（OpenAI 兼容）", group: "custom", baseUrl: "", model: "", keyUrl: "", hint: "自填 Base URL 与模型名" }
];
const GROUP_ORDER = ["official", "agg", "local", "custom"];
const GROUP_LABELS: Record<string, string> = { official: "官方云服务", agg: "聚合平台", local: "本地运行时", custom: "通用" };

function SkeletonBlock({ h = 40 }: { h?: number }) {
  return <div className="skeleton" style={{ height: h }} />;
}

// ---------- 界面语言（v49.8 / D182，sec-language）：语言切换唯一入口 ----------
// 语言名一律用该语言自称（LANGUAGES.name，不做翻译——切换器惯例）；切换即时全量生效并落盘 app.language。
function LanguageSection() {
  const T = useT();
  const [locale, setLocaleState] = useState<Locale>(getLocale());
  return (
    <SettingsSection id="sec-language" title={T("语言")}>
      <h4>{T("界面语言")}</h4>
      <div className="settings-row">
        <select
          value={locale}
          onChange={(e) => {
            const v = normalizeLocale(e.target.value);
            setLocaleState(v);
            void setLocale(v);
          }}
        >
          {LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>
      <p className="form-hint">{T("切换后立即生效：界面文字、图表、悬停提示与 AI 输出语言同步更新。")}</p>
    </SettingsSection>
  );
}

// ---------- 新信息架构（v48.70 / D114，设计稿 §5）----------
// 14 项平铺导航收编为 5 组 13 项；组标题为非交互 div，不进 .settings-nav button 查询集；
// 13 个导航项与 13 个 card-fill 区块一一对应（区块常挂载、无条件卸载，滚动定位一一可达）。
// v48.81（D125，用户指令）：新增「实验功能」（sec-lab，归「数据与效率」组末位），学习者知识模型
// 设置自 sec-widgets 迁入——左栏按钮 14 → 15（D114 立约文本记 13 项，DOM 实际计数 14，历史出入以实际为准）；
// 可达性沿用 92vh + 导航自滚兜底（D116）。
const SECTION_GROUPS: Array<{ label: string; items: Array<{ id: string; label: string }> }> = [
  { label: "界面", items: [{ id: "appearance", label: "主题与颜色" }, { id: "language", label: "语言" }] },
  { label: "阅读", items: [{ id: "reader", label: "阅读" }] },
  {
    label: "复习与调度",
    items: [
      { id: "extracts", label: "摘录复习" },
      { id: "limits", label: "每日上限" },
      { id: "schedule", label: "调度规则" },
      { id: "cardtags", label: "卡面与标签" },
      { id: "fsrs", label: "FSRS 优化" }
    ]
  },
  {
    label: "智能",
    items: [
      { id: "ai", label: "AI 服务" },
      { id: "dict", label: "词典与查词" }
      // v48.114（D159）：「用户记忆」（sec-memory）随功能暂时移除——重实装时按 §6.7 回插本项
    ]
  },
  {
    label: "数据与效率",
    items: [
      { id: "backup", label: "备份与恢复" },
      { id: "logs", label: "日志" },
      { id: "updates", label: "软件更新" },
      { id: "shortcuts", label: "快捷键" },
      { id: "widgets", label: "统计仪表盘" },
      { id: "lab", label: "实验功能" },
      // v49.7（D181）：开源许可与应用信息（纯信息节，零设置键）
      { id: "about", label: "关于" }
    ]
  }
];

// card-fill 区块容器（设计稿 §6.1/§7 薄壳）：h3 是 scrollIntoView 后的聚焦目标
// （tabindex=-1，屏幕阅读器可达），info 为挂在标题上的可选 ⓘ 说明。
function SettingsSection({ id, title, info, children }: { id: string; title: string; info?: ReactNode; children: ReactNode }) {
  return (
    <section className="settings-section card-fill" id={id}>
      <h3 tabIndex={-1}>
        {title}
        {info}
      </h3>
      {children}
    </section>
  );
}

// 给可能长时间挂起的 Promise 加超时上限（v45 用户反馈：测试连接失败后按钮永久置灰）。
// 主进程侧已有 socket 不活动超时（ai.js）双保险；渲染层超时保证 busy 状态必然恢复。
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`${label}超时（${Math.round(ms / 1000)} 秒无响应），已自动停止；请检查网络或服务地址后重试`));
    }, ms);
    p.then(
      (v) => { window.clearTimeout(timer); resolve(v); },
      (e) => { window.clearTimeout(timer); reject(e); }
    );
  });
}

// ---------- 统计仪表盘设置（组件可见性 + 宽窄 / 重置布局） ----------
function DashboardSection() {
  const T = useT();
  const [hidden, setHidden] = useState<string[]>([]);
  const [sizes, setSizes] = useState<Record<string, WidgetSize>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    settingsStore.get<DashLayoutV2 | null>("dashboard", "layout", null).then((l) => {
      setSizes(l?.sizes ?? {});
      setLoaded(true);
    });
  }, []);

  async function toggleWidget(id: string) {
    const next = hidden.includes(id) ? hidden.filter((h) => h !== id) : [...hidden, id];
    setHidden(next);
    await settingsStore.set("dashboard", "hiddenWidgets", next);
  }

  async function setWidgetSize(id: string, size: WidgetSize) {
    const next = { ...sizes, [id]: size };
    setSizes(next);
    // 写进现有 layout（无则建一份默认 order）
    const cur = await settingsStore.get<DashLayoutV2 | null>("dashboard", "layout", null);
    const base: DashLayoutV2 = cur && Array.isArray(cur.order) && cur.order.length
      ? cur
      : { order: WIDGETS.filter((w) => !nextHidden().includes(w.id)).map((w) => w.id), sizes: {} };
    function nextHidden(): string[] { return hidden; }
    await settingsStore.set("dashboard", "layout", { ...base, sizes: { ...base.sizes, [id]: size } });
  }

  async function resetLayout() {
    await settingsStore.set("dashboard", "layout", null);
    setSizes({});
  }

  return (
    <SettingsSection id="sec-widgets" title={T("统计仪表盘")}>
      {!loaded ? (
        <SkeletonBlock h={120} />
      ) : (
        <>
          <h4>
            {T("统计组件")}
            <SettingsInfo label={T("统计组件")}>
              {T("宽幅＝通栏一行；窄幅＝半幅，相邻窄幅自动两两成行。拖动组件标题栏可交换位置。")}
            </SettingsInfo>
          </h4>
          <div className="widget-list">
            {WIDGETS.map((w) => (
              <div key={w.id} className="widget-toggle">
                <label className="widget-toggle-main">
                  <input
                    type="checkbox"
                    checked={!hidden.includes(w.id)}
                    onChange={() => toggleWidget(w.id)}
                  />
                  <span>{w.title}</span>
                </label>
                <div className="seg-tabs seg-tabs-sm" role="group" aria-label={T("{title}宽度", { title: w.title })}>
                  <button
                    className={(sizes[w.id] ?? "wide") === "wide" ? "active" : ""}
                    onClick={() => setWidgetSize(w.id, "wide")}
                  >
                    {T("宽幅")}
                  </button>
                  <button
                    className={sizes[w.id] === "half" ? "active" : ""}
                    onClick={() => setWidgetSize(w.id, "half")}
                  >
                    {T("窄幅")}
                  </button>
                </div>
              </div>
            ))}
          </div>
          {/* sec-dashreset 撤销（D114）：「恢复默认排列与宽度」收编为本节一行 */}
          <div className="settings-row">
            <button className="btn btn-secondary btn-sm" onClick={resetLayout}>{T("恢复默认排列与宽度")}</button>
          </div>
        </>
      )}
    </SettingsSection>
  );
}

// 学习者知识模型（v48.80 / D124）：总开关 + 母语多选 + 推荐条数 + 两个按钮（§11.6）。
// 设置值统一走 learnerSettings（写后广播 settings/changed，NextStepsPanel 订阅即时卸载/恢复）。
// 界面文字一律来自 learnerStrings（§11.9，代码中不得硬编码用户可见文字）。
function LearnerBlock() {
  const S = learnerStringsSafe();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [nativeLangs, setNativeLangs] = useState<string[]>([]);
  const [recCount, setRecCount] = useState(6);
  const [tracksOpen, setTracksOpen] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);

  useEffect(() => {
    void (async () => {
      const s = await learnerSettings.read();
      setEnabled(s.enabled);
      setNativeLangs(s.effectiveNativeLangs);
      setRecCount(s.recCount);
    })();
  }, []);

  return (
    <>
      <h4>{S.settings.title}</h4>
      <div className="settings-row">
        <span className="settings-row-label">
          {S.settings.enabledLabel}
          <SettingsInfo label={S.settings.enabledLabel}>{S.settings.enabledInfo}</SettingsInfo>
        </span>
        <div className="seg-tabs seg-tabs-sm" role="group" aria-label={S.settings.enabledLabel}>
          <button
            className={enabled === true ? "active" : ""}
            onClick={() => {
              setEnabled(true);
              void learnerSettings.write({ enabled: true });
            }}
          >
            {S.settings.on}
          </button>
          <button
            className={enabled === false ? "active" : ""}
            onClick={() => {
              setEnabled(false);
              void learnerSettings.write({ enabled: false });
            }}
          >
            {S.settings.off}
          </button>
        </div>
      </div>
      {enabled !== false && (
        <>
          <div className="settings-row">
            <span className="settings-row-label">{S.settings.nativeLangs}</span>
            <NativeLangsPicker value={nativeLangs} onChange={(next) => { setNativeLangs(next); void learnerSettings.write({ nativeLangs: next }); }} />
          </div>
          <div className="settings-row">
            <span className="settings-row-label">{S.settings.recCount}</span>
            <input
              type="number"
              min={3}
              max={10}
              value={recCount}
              onChange={(e) => {
                const n = Math.min(10, Math.max(3, Math.round(Number(e.target.value) || 6)));
                setRecCount(n);
                void learnerSettings.write({ recCount: n });
              }}
            />
          </div>
          <div className="settings-row">
            <button className="btn btn-secondary btn-sm" onClick={() => setTracksOpen(true)}>
              {S.settings.manageTracks}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              disabled={rebuilding}
              onClick={() => {
                setRebuilding(true);
                void learnerApi.rebuild().finally(() => setRebuilding(false));
              }}
            >
              {rebuilding ? S.tracks.rebuilding : S.settings.rebuild}
            </button>
          </div>
        </>
      )}
      {tracksOpen && <TracksDialog onClose={() => setTracksOpen(false)} />}
    </>
  );
}

function AISection() {
  const T = useT();
  const [cfg, setCfg] = useState<AIConfig | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [modelFilter, setModelFilter] = useState("");
  const [modelInput, setModelInput] = useState("");
  const [modelsOpen, setModelsOpen] = useState(false);
  const [busy, setBusy] = useState<"" | "save" | "test" | "models" | "detect">("");
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [localDetect, setLocalDetect] = useState<LocalDetectResult | null>(null);
  const modelsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    aiGateway.getConfig().then((c) => {
      setCfg(c);
      if (c) setModelInput(c.model);
    });
  }, []);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (modelsRef.current && !modelsRef.current.contains(e.target as Node)) setModelsOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  async function save(partial: Record<string, unknown>) {
    const prevPreset = cfg?.preset;
    await aiGateway.setConfig(partial);
    const next = await aiGateway.getConfig();
    if (next) {
      setCfg(next);
      setModelInput(next.model);
    }
    // 切换预设：端点/模型重置；Key 按服务商独立留存，切回时自动恢复
    if (prevPreset && typeof partial.preset === "string" && partial.preset !== prevPreset) {
      setLocalDetect(null);
      setNotice(
        next?.hasKey
          ? { ok: true, text: T("已切换服务，并自动恢复了该服务之前保存的 API Key。") }
          : { ok: true, text: T("已切换服务。请粘贴该服务的 API Key 并保存。") }
      );
    }
  }

  // 不动 busy 状态的纯保存动作（供各 handler 复用）
  async function doSave(): Promise<AIConfig | null> {
    if (apiKey.trim()) {
      await save({ apiKey: apiKey.trim() });
      setApiKey("");
    }
    if (cfg) await save({ baseUrl: cfg.baseUrl, model: modelInput || cfg.model });
    const next = await aiGateway.getConfig();
    if (next) {
      setCfg(next);
      setModelInput(next.model);
    }
    return next;
  }

  async function handleSave(): Promise<AIConfig | null> {
    setBusy("save");
    try {
      return await doSave();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : String(err) });
      return null;
    } finally {
      setBusy("");
    }
  }

  async function handleTest() {
    setNotice(null);
    setModelsOpen(false);
    setBusy("test");
    try {
      const saved = await withTimeout(doSave(), 15000, T("保存配置"));
      // aiConfigUsable：本地预设免 Key（v48.68 / D112，与主进程 needKey 纪律对齐）
      if (!saved || !aiConfigUsable(saved)) {
        setNotice({ ok: false, text: T("请先粘贴 API Key，点击「保存配置」后再测试") });
        return;
      }
      const result = await withTimeout(aiGateway.test(), 90000, T("测试连接"));
      setNotice({ ok: result.ok, text: result.ok ? T("连接正常，AI 制卡 / 解释可用") : result.message });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy("");
    }
  }

  async function handleFetchModels() {
    setNotice(null);
    setBusy("models");
    try {
      await withTimeout(doSave(), 15000, T("保存配置"));
      const list = await withTimeout(aiGateway.listModels(), 30000, T("拉取模型列表"));
      setModels(list);
      setModelFilter("");
      setModelsOpen(list.length > 0);
      setNotice({
        ok: true,
        text: list.length > 0 ? T("已拉取 {n} 个模型 — 点击「模型名」框从列表选择", { n: list.length }) : T("服务未返回模型列表，请手输")
      });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy("");
    }
  }

  // 本地运行时探测（v48.68 / D112）：主进程扫 Ollama/LM Studio 默认端口，
  // 命中即采用其地址并把模型列表填入下拉；未命中给可读指引，绝不挂死
  async function handleDetectLocal() {
    setNotice(null);
    setModelsOpen(false);
    setBusy("detect");
    try {
      const r = await withTimeout(aiGateway.detectLocal(), 20000, T("检测本地服务"));
      if (!r) {
        setNotice({ ok: false, text: T("当前应用不支持本地探测，请重启应用后再试") });
        return;
      }
      setLocalDetect(r);
      if (r.detected) {
        if (r.baseUrl && cfg && r.baseUrl !== cfg.baseUrl) await save({ baseUrl: r.baseUrl });
        setModels(r.models || []);
        setModelFilter("");
        setNotice({
          ok: true,
          text: T("检测到 {name}（{url}）· {n} 个模型已填入「模型名」下拉", { name: r.runtimeName || T("本地服务"), url: r.baseUrl, n: (r.models || []).length })
        });
      } else {
        setNotice({ ok: false, text: r.message || T("未检测到本地模型服务") });
      }
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy("");
    }
  }

  if (!cfg) return null;

  const presets: AiPresetMeta[] = cfg.presets && cfg.presets.length > 0 ? cfg.presets : FALLBACK_PRESETS;
  const presetMeta = presets.find((p) => p.id === cfg.preset);
  const filtered = modelFilter
    ? models.filter((m) => m.toLowerCase().includes(modelFilter.toLowerCase()))
    : models;

  return (
    <SettingsSection id="sec-ai" title={T("AI 服务")}>
      {GROUP_ORDER.map((g) => {
        const items = presets.filter((p) => (p.group || "official") === g);
        if (items.length === 0) return null;
        return (
          <div key={g} className="ai-preset-group">
            <p className="ai-preset-group-label">{T(GROUP_LABELS[g] || g)}</p>
            <div className="skin-list">
              {items.map((p) => (
                <button
                  key={p.id}
                  className={cfg.preset === p.id ? "active" : ""}
                  onClick={() => save({ preset: p.id })}
                >
                  <span className="ai-preset-name">{p.name}</span>
                  {/* D115：名称后缀灰字（p.hint）不再渲染；hint 数据仍在注册表，Key 区引导语仍消费 */}
                </button>
              ))}
            </div>
          </div>
        );
      })}

      {presetMeta?.keyUrl && (
        <p className="form-hint">
          {T("在")}{" "}
          <a href={presetMeta.keyUrl} target="_blank" rel="noreferrer">
            {presetMeta.name}
          </a>{" "}
          {T("创建 Key。")}{presetMeta.hint}
        </p>
      )}

      {cfg.preset === "local" && (
        <div className="settings-row settings-row-wrap">
          <button className="btn btn-outline btn-sm" disabled={busy !== ""} onClick={handleDetectLocal}>
            {busy === "detect" ? T("检测中…") : T("检测本地服务")}
          </button>
          {localDetect && (
            <span className={localDetect.detected ? "ai-test-ok" : "ai-test-fail"}>
              {localDetect.detected
                ? T("已检测到 {name}", { name: localDetect.runtimeName || T("本地服务") })
                : (localDetect.message || T("未检测到本地模型服务"))}
            </span>
          )}
        </div>
      )}

      <div className="ai-fields">
        {cfg.preset === "custom" && (
          <div className="form-field">
            <label>{T("Base URL（OpenAI 兼容，含 /v1）")}</label>
            <input
              value={cfg.baseUrl}
              placeholder="https://api.example.com/v1"
              onChange={(e) => setCfg({ ...cfg, baseUrl: e.target.value })}
            />
          </div>
        )}
        {cfg.preset === "local" && (
          <div className="form-field">
            <label>
              {T("服务地址（Ollama 默认 11434，LM Studio 默认 1234）")}
              <SettingsInfo label={T("服务地址")}>{T("本机服务无需 API Key；端口 Ollama 11434 / LM Studio 1234。")}</SettingsInfo>
            </label>
            <input
              className="mono"
              value={cfg.baseUrl}
              placeholder="http://localhost:11434/v1"
              onChange={(e) => setCfg({ ...cfg, baseUrl: e.target.value })}
            />
            {!/\/v\d+$/.test(cfg.baseUrl.trim()) && (
              <p className="ai-test-fail">
                {T("地址缺少 /v1 后缀 —— OpenAI 兼容端点通常需要它（如 http://127.0.0.1:1234/v1）")}
              </p>
            )}
          </div>
        )}

        <div className="form-field" ref={modelsRef}>
          <label>{T("模型名")}</label>
          <div className="model-select">
            <input
              className="mono"
              value={modelInput}
              placeholder={presetMeta?.model || T("模型名（可手输）")}
              onChange={(e) => {
                const v = e.target.value;
                setModelInput(v);
                setCfg({ ...cfg, model: v });
                // 有模型列表时才进入搜索过滤
                if (models.length > 0) setModelsOpen(true);
              }}
              onFocus={() => {
                if (models.length > 0) {
                  setModelFilter(cfg.model);
                  setModelsOpen(true);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") setModelsOpen(false);
              }}
            />
            {modelsOpen && models.length > 0 && (
              <div className="model-dropdown">
                {filtered
                  .filter((m) => m !== modelInput)
                  .map((m) => (
                    <button
                      key={m}
                      className={`model-option mono${m === cfg.model ? " model-option-active" : ""}`}
                      onClick={() => {
                        setCfg({ ...cfg, model: m });
                        setModelInput(m);
                        setModelsOpen(false);
                      }}
                    >
                      {m}
                    </button>
                  ))}
                {filtered.length === 0 && (
                  <div className="model-option model-empty mono">
                    {T("列表无匹配 — 将直接使用手输的模型名")}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/glm-5\.[2-9]/i.test(cfg.model) && (
          <div className="form-field">
            <label>{T("思考强度（低更快；仅 GLM-5.2+ 生效）")}</label>
            <div className="seg-tabs">
              {[
                { id: "low", label: T("低") },
                { id: "high", label: T("中") },
                { id: "max", label: T("强") }
              ].map((o) => (
                <button
                  key={o.id}
                  className={(cfg.reasoningEffort || "low") === o.id ? "active" : ""}
                  onClick={() => save({ reasoningEffort: o.id })}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {cfg.preset !== "local" && (
          <div className="form-field">
            <label>{T("API Key {state}", { state: cfg.hasKey ? T("（已保存）") : T("（尚未保存 — 填好后点「保存配置」）") })}</label>
            <input
              type="password"
              value={apiKey}
              placeholder={cfg.hasKey ? "••••••••" : "cmd-… / sk-…"}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>
        )}
      </div>

      <div className="settings-row settings-row-wrap">
        <button className="btn btn-primary btn-sm" disabled={busy !== ""} onClick={handleSave}>
          {busy === "save" ? T("保存中…") : T("保存配置")}
        </button>
        <button className="btn btn-secondary btn-sm" disabled={busy !== ""} onClick={handleTest}>
          {busy === "test" ? T("测试中…") : T("测试连接")}
        </button>
        <button className="btn btn-outline btn-sm" disabled={busy !== ""} onClick={handleFetchModels}>
          {busy === "models" ? T("拉取中…") : T("拉取模型列表")}
        </button>
      </div>

      {(busy === "test" || busy === "models" || busy === "save") && <SkeletonBlock h={32} />}
      {notice && <p className={notice.ok ? "ai-test-ok" : "ai-test-fail"}>{notice.text}</p>}
    </SettingsSection>
  );
}

// ---------- 调度规则（v48.70 / D114）：学习日 + 同源卡延后物理合并 ----------
// 两个 h4 子块的根元素保留 id sec-learningday / sec-siblingbury（m12 直达定位，设计稿 §5.3/§12-T4）。
function ScheduleSection() {
  const T = useT();
  return (
    <SettingsSection id="sec-schedule" title={T("调度规则")}>
      <div id="sec-learningday">
        <LearningDayBlock />
      </div>
      <div id="sec-siblingbury">
        <SiblingBuryBlock />
      </div>
    </SettingsSection>
  );
}

// 学习日（v23，D21/§4.4.8）：统计口径的「新一天」起点 = 本地钟面 0-23 时，默认 0（午夜）。
// 仅影响统计（今日完成度/热力/日聚合）；FSRS 调度间隔与优化训练不受其影响。
function LearningDayBlock() {
  const T = useT();
  const [cutoff, setCutoff] = useState<number | null>(null);
  const [savedTick, setSavedTick] = useState(0);
  useEffect(() => {
    settingsStore.get<number>("app", "dayCutoffHour", 0).then((v) => setCutoff(Number(v) || 0));
  }, []);
  const options = Array.from({ length: 24 }, (_, h) => ({
    value: String(h),
    label: h === 0 ? T("午夜 0 点（默认）") : T("凌晨/上午 {h} 点", { h })
  }));
  async function update(v: string) {
    const h = Number(v);
    setCutoff(h);
    await settingsStore.set("app", "dayCutoffHour", h);
    setSavedTick((t) => t + 1);
    window.setTimeout(() => setSavedTick((t) => t + 1), 2000);
  }
  return (
    <>
      <h4>{T("学习日")}</h4>
      <div className="settings-row">
        <span className="settings-row-label">
          {T("新一天从")}
          <SettingsInfo label={T("新一天从")}>{T("凌晨的学习计入前一天。仅影响统计与热力图，不影响 FSRS 复习间隔。")}</SettingsInfo>
        </span>
        {cutoff !== null && (
          <Dropdown value={String(cutoff)} options={options} align="left" onChange={update} title={T("学习日切点")} />
        )}
      </div>
      {savedTick % 2 === 1 && <p className="ai-test-ok settings-saved">{T("已保存，统计口径即时生效。")}</p>}
    </>
  );
}

// 同源卡延后（v34，M12/D33/§4.16）：同一制卡来源单元的多张卡同一学习日只放行一张、其余延至次日。
// 延后是队列视图而非调度写入——不改 FSRS 的 due/S/D，不产生复习日志，次日自动解封。
function SiblingBuryBlock() {
  const T = useT();
  const [cfg, setCfg] = useState<{ enabled: boolean; newCards: boolean; reviewCards: boolean; perDay: number; sourceTextLimit: number } | null>(null);
  const [savedTick, setSavedTick] = useState(0);
  useEffect(() => {
    settingsStore
      .get<Partial<{ enabled: boolean; newCards: boolean; reviewCards: boolean; perDay: number; sourceTextLimit: number }> | null>("app", "siblingBury", null)
      .then((v) =>
        setCfg({
          enabled: v?.enabled !== false,
          newCards: v?.newCards !== false,
          reviewCards: v?.reviewCards !== false,
          perDay: Number.isInteger(v?.perDay) && (v?.perDay as number) >= 1 ? (v!.perDay as number) : 1,
          sourceTextLimit: Number.isInteger(v?.sourceTextLimit) && (v?.sourceTextLimit as number) > 0 ? (v!.sourceTextLimit as number) : 300
        })
      );
  }, []);
  async function update(patch: Partial<NonNullable<typeof cfg>>) {
    if (!cfg) return;
    const next = { ...cfg, ...patch };
    setCfg(next);
    await settingsStore.set("app", "siblingBury", next);
    setSavedTick((t) => t + 1);
    window.setTimeout(() => setSavedTick((t) => t + 1), 2000);
  }
  return (
    <>
      <h4>
        {T("同源卡延后")}
        <SettingsInfo label={T("同源卡延后")}>{T("同源组同日只放行一张，防互相泄题；不改调度，次日自动解封，仍可在卡片浏览页主动复习。")}</SettingsInfo>
      </h4>
      {cfg && (
        <>
          <div className="settings-row">
            <span>{T("同源卡延后")}</span>
            <div className="seg-tabs seg-tabs-sm" role="group" aria-label={T("同源卡延后开关")}>
              <button className={cfg.enabled ? "active" : ""} onClick={() => update({ enabled: true })}>{T("开")}</button>
              <button className={!cfg.enabled ? "active" : ""} onClick={() => update({ enabled: false })}>{T("关")}</button>
            </div>
          </div>
          <div className="settings-row">
            <span>{T("新卡同源延后")}</span>
            <input type="checkbox" checked={cfg.newCards} onChange={(e) => update({ newCards: e.target.checked })} />
          </div>
          <div className="settings-row">
            <span>{T("复习卡同源延后")}</span>
            <input type="checkbox" checked={cfg.reviewCards} onChange={(e) => update({ reviewCards: e.target.checked })} />
          </div>
          <div className="settings-row">
            <span>{T("同源组每日放行")}</span>
            <input
              className="mono input-num"
              type="number"
              min={1}
              max={20}
              value={cfg.perDay}
              onChange={(e) => update({ perDay: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })}
            />
            <span>{T("张")}</span>
          </div>
          <div className="settings-row settings-row-wrap">
            <span className="settings-row-label">
              {T("短材料阈值")}
              <SettingsInfo label={T("短材料阈值")}>{T("该字符数以内才按「同一次选区」建组（长选区各卡锚定不同知识点，不延后）。")}</SettingsInfo>
            </span>
            <input
              className="mono input-num input-num-md"
              type="number"
              min={50}
              max={100000}
              step={50}
              value={cfg.sourceTextLimit}
              onChange={(e) => update({ sourceTextLimit: Math.max(50, Number(e.target.value) || 300) })}
            />
          </div>
        </>
      )}
      {savedTick % 2 === 1 && <p className="ai-test-ok settings-saved">{T("已保存，队列即时生效。")}</p>}
    </>
  );
}

// ---------- 卡面与标签（v48.70 / D114）：卡面信息密度 + 标签功能总开关物理合并 ----------
// data-cf-* / tags-enabled-toggle / data-tags-on/off 钩原样保留（d104/d107 为 document 级查询，位置无关）。
function CardTagsSection() {
  const T = useT();
  return (
    <SettingsSection id="sec-cardtags" title={T("卡面与标签")}>
      <WorkbenchBlock />
      <CardFaceBlock />
      <TagsBlock />
    </SettingsSection>
  );
}

// 制卡台放置位置（v48.79，D123）：右侧（默认）/ 底部。与使用习惯相关、很少调整，所以放设置而不放在面板上。
function WorkbenchBlock() {
  const T = useT();
  const [placement, setPlacement] = useState<WorkbenchPlacement | null>(null);
  useEffect(() => {
    void settingsStore.get<unknown>("app", "workbenchPlacement", "right").then((v) => setPlacement(normalizePlacement(v)));
  }, []);
  async function change(next: WorkbenchPlacement) {
    setPlacement(next);
    await settingsStore.set("app", "workbenchPlacement", next);
  }
  return (
    <>
      <h4>
        {T("制卡台")}
        <SettingsInfo label={T("制卡台")}>
          {T("手动制卡、AI 制卡、AI 解释都在制卡台里；顶栏「制卡台」按钮或 Ctrl+K 开合。最大化时向内推，非最大化时窗口会向右变宽（屏幕放不下则向内推）。")}
        </SettingsInfo>
      </h4>
      <div className="settings-row">
        <span className="settings-row-label">{T("放置位置")}</span>
        <div className="seg-tabs" role="radiogroup" aria-label={T("制卡台放置位置")}>
          {(["right", "bottom"] as const).map((m) => (
            <button key={m} role="radio" aria-checked={placement === m} data-wb-placement={m} className={placement === m ? "active" : ""} onClick={() => void change(m)}>
              {m === "right" ? T("右侧") : T("底部")}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

// 卡面信息密度（v48.61，D104/D94 设计稿 §3.5）：背面辅助字段三开关
// 纯显示开关：关闭即不渲染对应块；不改卡内数据、不影响 CardLint。作用于复习页背面与卡详情预览（同一组件）。
function CardFaceBlock() {
  const T = useT();
  const [cfg, setCfg] = useState<{ mnemonic: boolean; example: boolean; sourceRef: boolean } | null>(null);
  const [savedTick, setSavedTick] = useState(0);
  useEffect(() => {
    settingsStore.get<unknown>("app", "cardFaceExtras", null).then((v) => {
      const src = (v && typeof v === "object" && !Array.isArray(v) ? v : {}) as Record<string, unknown>;
      setCfg({
        mnemonic: src.mnemonic !== false,
        example: src.example !== false,
        sourceRef: src.sourceRef !== false
      });
    });
  }, []);
  async function update(patch: Partial<NonNullable<typeof cfg>>) {
    if (!cfg) return;
    const next = { ...cfg, ...patch };
    setCfg(next);
    await settingsStore.set("app", "cardFaceExtras", next);
    setSavedTick((t) => t + 1);
    window.setTimeout(() => setSavedTick((t) => t + 1), 2000);
  }
  return (
    <>
      <h4>
        {T("卡面信息密度")}
        <SettingsInfo label={T("卡面信息密度")}>{T("关闭即不渲染对应块；不改卡内数据，也不影响制卡时的质检。")}</SettingsInfo>
      </h4>
      {cfg && (
        <>
          <div className="settings-row">
            <span>{T("显示助记")}</span>
            <input type="checkbox" data-cf-mnemonic checked={cfg.mnemonic} onChange={(e) => update({ mnemonic: e.target.checked })} />
          </div>
          <div className="settings-row">
            <span>{T("显示例子")}</span>
            <input type="checkbox" data-cf-example checked={cfg.example} onChange={(e) => update({ example: e.target.checked })} />
          </div>
          <div className="settings-row">
            <span>{T("显示来源")}</span>
            <input type="checkbox" data-cf-source checked={cfg.sourceRef} onChange={(e) => update({ sourceRef: e.target.checked })} />
          </div>
        </>
      )}
      {savedTick % 2 === 1 && <p className="ai-test-ok settings-saved">{T("已保存，卡面即时生效。")}</p>}
    </>
  );
}

// ---------- 标签功能总开关（v48.63，D107）：一键开启/关闭全部标签入口与展示 ----------
// 覆盖：手动制卡标签行、AI 制卡的批注标签继承（批 F 的 AI 建议标签届时同受此开关）、
// 复习页标签区与快捷打标、浏览器批量打标/去标、卡详情标签区、筛选牌组构建器标签条件。
// 只隐藏入口与展示——已存标签数据零改动，重新打开即恢复；查询 tag: 与已存 scope 照常生效。
function TagsBlock() {
  const T = useT();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [savedTick, setSavedTick] = useState(0);
  useEffect(() => {
    settingsStore.get<unknown>("app", "tagsEnabled", null).then((v) => setEnabled(v !== false));
  }, []);
  async function update(next: boolean) {
    setEnabled(next);
    await settingsStore.set("app", "tagsEnabled", next);
    // 广播设置变更（App 主题/皮肤同款事件）——设置模态常开在当前视图之上，宿主不重挂载也能即时生效
    eventBus.emit("settings/changed", { scope: "app", key: "tagsEnabled" });
    setSavedTick((t) => t + 1);
    window.setTimeout(() => setSavedTick((t) => t + 1), 2000);
  }
  return (
    <>
      <h4>{T("标签功能")}</h4>
      {enabled !== null && (
        <div className="settings-row">
          <span className="settings-row-label">
            {T("启用标签功能")}
            <SettingsInfo label={T("启用标签功能")}>{T("关闭隐藏全部标签入口与展示（AI 标签建议同停）；已存标签数据原样保留，重开即恢复。")}</SettingsInfo>
          </span>
          <div className="seg-tabs seg-tabs-sm" role="group" aria-label={T("标签功能开关")} data-testid="tags-enabled-toggle">
            <button className={enabled ? "active" : ""} data-tags-on onClick={() => update(true)}>{T("开")}</button>
            <button className={!enabled ? "active" : ""} data-tags-off onClick={() => update(false)}>{T("关")}</button>
          </div>
        </div>
      )}
      {savedTick % 2 === 1 && <p className="ai-test-ok settings-saved">{T("已保存，各界面即时生效。")}</p>}
    </>
  );
}

// ---------- 摘录复习（v48.22，D58/§6.8）：并入复习队列 / 混编模式 / 推送引擎 ----------
// 实验项必须带「实验功能 · 早期开发阶段」标识与说明（用户口径）；切换推送引擎为**无损**操作
// （每引擎私有子空间互不覆盖，A→B→A 往返逐字段等值，指南 §6.8-4）。
function ExtractReviewSection() {
  const T = useT();
  const [cfg, setCfg] = useState<{ mergeIntoReview: boolean; interleave: InterleaveMode; engine: ExtractEngine } | null>(null);
  const [savedTick, setSavedTick] = useState(0);
  const [rerankNote, setRerankNote] = useState<string | null>(null);
  // v48.80（D124 / 设计稿 §9.5）：E2 知识点就绪度说明随学习者模型总开关显示
  const [learnerOn, setLearnerOn] = useState(true);
  const frontierNote = learnerOn ? learnerStringsSafe().settings.frontierReady : learnerStringsSafe().settings.frontierOff;
  useEffect(() => {
    void learnerSettings.read().then((s) => setLearnerOn(s.enabled));
    const off = eventBus.on("settings/changed", (p) => {
      if ((p as { scope?: string; key?: string } | undefined)?.key !== "learner") return;
      void learnerSettings.read().then((s) => setLearnerOn(s.enabled));
    });
    return off;
  }, []);
  const [busyRerank, setBusyRerank] = useState(false);
  async function runRerank() {
    setBusyRerank(true);
    setRerankNote(null);
    try {
      const r = await rerankExtractsNow();
      if (!r.ok) setRerankNote(T("未能重排：{reason}", { reason: r.reason || T("未知原因") }));
      else if (r.usedAI) setRerankNote(T("已按 AI 重排 {n} 条（之后的摘录写操作会自动刷新）", { n: r.count }));
      else setRerankNote(T("未采用 AI 结果：{reason}——当前用本地因子序", { reason: r.reason || T("输出未通过本地裁决") }));
    } catch (e) {
      setRerankNote(T("重排失败：{msg}", { msg: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusyRerank(false);
    }
  }
  useEffect(() => {
    void extractSettings.read().then(setCfg);
  }, []);
  async function update(patch: Partial<NonNullable<typeof cfg>>) {
    if (!cfg) return;
    const next = { ...cfg, ...patch };
    setCfg(next);
    await extractSettings.write(patch);
    setSavedTick((t) => t + 1);
    window.setTimeout(() => setSavedTick((t) => t + 1), 2000);
  }
  return (
    <SettingsSection id="sec-extracts" title={T("摘录复习")}>
      {cfg && (
        <>
          <div className="settings-row">
            <span className="settings-row-label">
              {T("并入复习队列（传统 SuperMemo 方式）")}
              <SettingsInfo label={T("并入复习队列")}>{T("开启后复习时按混编规则推送摘录卡，可就地处理；关闭时摘录在顶栏「摘录」页连续处理。")}</SettingsInfo>
            </span>
            <div className="seg-tabs seg-tabs-sm" role="group" aria-label={T("摘录并入复习队列")}>
              <button className={cfg.mergeIntoReview ? "active" : ""} onClick={() => void update({ mergeIntoReview: true })}>{T("开")}</button>
              <button className={!cfg.mergeIntoReview ? "active" : ""} onClick={() => void update({ mergeIntoReview: false })}>{T("关")}</button>
            </div>
          </div>
          <div className="settings-row">
            <span className="settings-row-label">
              {T("混编规则")}
              <SettingsInfo label={T("混编规则")}>{T("切换不写任何调度状态：未放行的摘录仍在库内到期，切换后立即可见。")}</SettingsInfo>
            </span>
            <Dropdown
              value={cfg.interleave}
              align="left"
              options={[
                { value: "quota-1-4", label: T("上限 1:4（每 4 张卡至多 1 条摘录，SuperMemo 口径）") },
                { value: "by-due", label: T("按到期时间自然混排") }
              ]}
              onChange={(v) => void update({ interleave: v as InterleaveMode })}
            />
          </div>
          <div className="settings-row">
            <span className="settings-row-label">
              {T("摘录推送引擎")}
              <SettingsInfo label={T("摘录推送引擎")}>
                {T("实验引擎按本地因子（优先级/逾期/搁置/同书连击）排序并给逐条可验证理由；AI 重排只影响处理顺序、经本地裁决过滤；{note}。切回 SuperMemo 无损。", { note: frontierNote })}
              </SettingsInfo>
            </span>
            <Dropdown
              value={cfg.engine}
              align="left"
              options={[
                { value: "sm19-default", label: EXTRACT_ENGINE_LABEL["sm19-default"] },
                { value: "ai-next-extract", label: EXTRACT_ENGINE_LABEL["ai-next-extract"] }
              ]}
              onChange={(v) => void update({ engine: v as ExtractEngine })}
            />
          </div>
          {cfg.engine === "ai-next-extract" && (
            <>
              {/* 实验标识句按契约保留行内（D114 §9）；完整语义入「摘录推送引擎」tooltip */}
              <p className="form-hint">{T("实验功能 · 早期开发阶段。")}</p>
              <div className="settings-row">
                <span>{T("AI 重排")}</span>
                <button className="btn btn-outline btn-sm" data-rerank-now disabled={busyRerank} onClick={() => void runRerank()}>
                  {T("立即重排（对当前到期批）")}
                </button>
              </div>
              {rerankNote && <p className="form-hint">{rerankNote}</p>}
            </>
          )}
        </>
      )}
      {savedTick % 2 === 1 && <p className="ai-test-ok settings-saved">{T("已保存，队列即时生效。")}</p>}
    </SettingsSection>
  );
}

// ---------- 每日上限（v48.22，D58/§6.8-5）：四类上限 + 三层限幅 ----------
// 硬边界（复习上限 ≥ 新上限 × 5）由**主进程 settings:set 兜底拒写**，此处只做即时提示；
// 用量为派生值（review_logs / extract_ops），重启不漂移。
function LimitsSection() {
  const T = useT();
  const [limits, setLimits] = useState<Limits | null>(null);
  const [state, setState] = useState<LimitsState | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [advisory, setAdvisory] = useState<string[]>([]);
  const [savedTick, setSavedTick] = useState(0);
  useEffect(() => {
    void (async () => {
      setLimits(await extractSettings.readLimits());
      setState(await fetchLimitsState());
    })();
  }, []);
  async function save(patch: Partial<Limits>) {
    if (!limits) return;
    const next = { ...limits, ...patch };
    const verdict = await validateLimits(next);
    setErrors(verdict.errors);
    setAdvisory(verdict.advisory);
    if (!verdict.ok) return; // 硬边界：拒绝保存并就地解释（主进程另有一道兜底）
    setLimits(next);
    try {
      await extractSettings.writeLimits(next);
      setState(await fetchLimitsState());
      setSavedTick((t) => t + 1);
      window.setTimeout(() => setSavedTick((t) => t + 1), 2000);
    } catch (e) {
      setErrors([e instanceof Error ? e.message : String(e)]);
    }
  }
  const num = (label: string, key: keyof Limits, hint: string, tip?: ReactNode) => (
    <div className="settings-row settings-row-wrap" key={key}>
      {tip ? (
        <span className="settings-row-label">
          {label}
          {tip}
        </span>
      ) : (
        <span>{label}</span>
      )}
      <input
        className="mono input-num input-num-md"
        type="number"
        min={0}
        max={9999}
        value={limits ? Number(limits[key]) : 0}
        onChange={(e) => void save({ [key]: Math.max(0, Math.min(9999, Number(e.target.value) || 0)) } as Partial<Limits>)}
      />
      <span className="form-hint">{hint}</span>
    </div>
  );
  return (
    <SettingsSection
      id="sec-limits"
      title={T("每日上限")}
      info={
        <SettingsInfo label={T("每日上限")}>
          {T("四类上限按学习日（「新一天从」时刻）计算，全部范围共享同一份额度；填 0 表示不限制。")}
        </SettingsInfo>
      }
    >
      {limits && (
        <>
          {num(T("每日新卡片上限"), "newCardsPerDay", T("首次作答的卡片张数"))}
          {num(
            T("每日卡片复习上限"),
            "cardReviewsPerDay",
            T("卡片作答总次数（新卡与复习卡共用）"),
            <SettingsInfo label={T("每日卡片复习上限")}>
              {T("硬边界：不得低于新卡上限的 5 倍；低于 10 倍时给出提示（Anki 经验：20 张新卡约 200 次复习/日）。")}
            </SettingsInfo>
          )}
          {num(T("每日新摘录上限"), "newExtractsPerDay", T("新引入的摘录条数"))}
          {num(T("每日摘录处理上限"), "extractReviewsPerDay", T("到期摘录的处理条数"))}
          <div className="settings-row">
            <span className="settings-row-label">
              {T("复习上限用尽后仍发新卡与新摘录")}
              <SettingsInfo label={T("复习上限用尽后仍发新卡与新摘录")}>{T("关闭（默认）＝防积压的结构闸：复习额度用尽即停发新卡与新摘录。")}</SettingsInfo>
            </span>
            <input
              type="checkbox"
              checked={limits.ignoreReviewLimitForNew}
              onChange={(e) => void save({ ignoreReviewLimitForNew: e.target.checked })}
            />
          </div>
          {state && (
            <p className="form-hint">
              {T("今日已用：新卡 {a}/{b} · 复习 {c}/{d} · 新摘录 {e}/{f} · 摘录处理 {g}/{h}", {
                a: state.usage.newCards, b: state.limits.newCardsPerDay || "∞",
                c: state.usage.cardReviews, d: state.limits.cardReviewsPerDay || "∞",
                e: state.usage.newExtracts, f: state.limits.newExtractsPerDay || "∞",
                g: state.usage.extractReviews, h: state.limits.extractReviewsPerDay || "∞"
              })}
              {state.newBlocked ? T("（复习额度已用尽，新卡与新摘录已停发）") : ""}
            </p>
          )}
        </>
      )}
      {errors.length > 0 && <p className="ai-test-err">{errors.join(T("；"))}</p>}
      {errors.length === 0 && advisory.length > 0 && <p className="form-hint">{T("提示：")}{advisory.join(T("；"))}</p>}
      {savedTick % 2 === 1 && <p className="ai-test-ok settings-saved">{T("已保存，队列即时生效。")}</p>}
    </SettingsSection>
  );
}

// ---------- 用户记忆（v45，M14-UM1，D39 / §6.7）----------
// v48.114（D159）：用户记忆功能暂时移除——MemorySection（sec-memory）整体摘除，代码存于 git 历史与
// §6.7 冻结契约（重实装时按契约恢复区块：总开关/文件位置/立即整理/注入预算/补处理/重置记忆/一次性说明）。

// FSRS 参数优化（v12）：从复习记录训练个性化权重（fsrs-rs-nodejs），应用后调度即刻生效
function FSRSSection() {
  const T = useT();
  const [stats, setStats] = useState<{ reviewCount: number; cardCount: number; minRecommended: number; enough: boolean } | null>(null);
  const [activeSource, setActiveSource] = useState<string | null>(null);
  const [trainedW, setTrainedW] = useState<number[] | null>(null);
  const [metrics, setMetrics] = useState<{ logLoss: number; rmseBins: number } | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    (window as unknown as { optimizerAPI?: { stats: () => Promise<{ reviewCount: number; cardCount: number; minRecommended: number; enough: boolean }> } }).optimizerAPI
      ?.stats()
      .then(setStats)
      .catch(() => setStats(null));
    // v23：当前活跃配置返回完整快照；此处只取来源用于展示（引擎热重建由主进程推送驱动，F9）
    (window as unknown as { optimizerAPI?: { current: () => Promise<{ id: string; source: string } | null> } }).optimizerAPI
      ?.current()
      .then((cfg) => setActiveSource(cfg?.source ?? null))
      .catch(() => setActiveSource(null));
  }, []);

  async function handleTrain() {
    setBusy(true);
    setNotice(null);
    setTrainedW(null);
    setMetrics(null);
    setProgress(0);
    try {
      const api = (window as unknown as {
        optimizerAPI?: {
          train: () => Promise<{ ok: boolean; error?: string; weights?: number[]; reviewCount?: number; cardCount?: number; logLoss?: number; rmseBins?: number }>;
          onProgress: (cb: (p: { percent: number }) => void) => () => void;
        };
      }).optimizerAPI!;
      const off = api.onProgress((p) => setProgress(Math.round(p.percent)));
      const result = await api.train();
      off();
      if (result.ok && result.weights) {
        setTrainedW(result.weights);
        setMetrics({ logLoss: result.logLoss ?? 0, rmseBins: result.rmseBins ?? 0 });
        setNotice({
          ok: true,
          text: T("训练完成：{reviews} 条复习记录（{cards} 张卡）。点击「应用」后新权重立即生效。", { reviews: result.reviewCount, cards: result.cardCount })
        });
      } else {
        setNotice({ ok: false, text: result.error || T("训练失败") });
      }
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function handleApply() {
    if (!trainedW) return;
    const api = (window as unknown as { optimizerAPI?: { apply: (w: number[]) => Promise<{ ok: boolean; configId?: string }> } }).optimizerAPI!;
    // v23：apply 只移动 fsrsConfigId 指针；主进程提交成功后广播 fsrs:configChanged 热重建引擎（F9）
    const result = await api.apply(trainedW);
    if (result?.ok) {
      setTrainedW(null);
      setActiveSource("optimizer");
      setNotice({ ok: true, text: T("已应用优化权重，复习调度即刻使用新参数。") });
    } else {
      setNotice({ ok: false, text: T("应用失败，请重试。") });
    }
  }

  async function handleReset() {
    const api = (window as unknown as { optimizerAPI?: { reset: () => Promise<{ ok: boolean; configId?: string }> } }).optimizerAPI!;
    const result = await api.reset();
    if (result?.ok) {
      setActiveSource("default");
      setNotice({ ok: true, text: T("已恢复 FSRS 默认参数。") });
    } else {
      setNotice({ ok: false, text: T("恢复失败，请重试。") });
    }
  }

  return (
    <SettingsSection id="sec-fsrs" title={T("FSRS 参数优化")}>
      {stats && (
        <p className="form-hint">
          {T("复习记录 {n} 条", { n: stats.reviewCount })}
          {stats.enough ? T("，可优化") : T("（建议 {min}+ 条后再优化）", { min: stats.minRecommended })}
        </p>
      )}
      <p className="form-hint">{T("当前参数：")}{activeSource === "optimizer" ? T("优化权重") : T("默认参数")}</p>

      <div className="settings-row settings-row-wrap">
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={handleTrain}>
          {busy ? T("训练中… {pct}%", { pct: progress !== null ? progress : "" }) : T("开始优化")}
        </button>
        {trainedW && (
          <button className="btn btn-secondary btn-sm" onClick={handleApply}>
            {T("应用优化结果")}
          </button>
        )}
        {activeSource === "optimizer" && (
          <button className="btn btn-outline btn-sm" onClick={handleReset}>
            {T("恢复默认")}
          </button>
        )}
      </div>

      {metrics && (
        <p className="form-hint">
          logLoss <span className="mono">{metrics.logLoss.toFixed(4)}</span> · RMSE{" "}
          <span className="mono">{metrics.rmseBins.toFixed(4)}</span>
        </p>
      )}
      {notice && <p className={notice.ok ? "ai-test-ok" : "ai-test-fail"}>{notice.text}</p>}
    </SettingsSection>
  );
}

/** 批 4：五键的初值（与 lib/annotationSettings 的默认值同源） */
const DEFAULT_ANNOT_SETTINGS: AnnotationSettings = {
  annotateMode: DEFAULT_ANNOTATE_MODE,
  annotateForm: DEFAULT_ANNOTATE_FORM,
  annotatePalette: [...DEFAULT_ANNOTATE_PALETTE],
  annotateCustomEnabled: true,
  annotationFilter: DEFAULT_ANNOTATION_FILTER
};

/** 色板增删：已选则移出，未选则加入（上限 8；主进程写侧还会再净化一次） */
function togglePaletteColor(current: string[], color: string): string[] {
  if (current.includes(color)) return current.filter((c) => c !== color);
  if (current.length >= ANNOT_PALETTE_MAX) return current;
  return [...current, color];
}

// ---------- 阅读外观（v20 R1b）：与阅读器快捷控件共用 settings.app.readerSettings ----------
function ReaderSection() {
  const T = useT();
  const [cfg, setCfg] = useState<ReaderSettings | null>(null);
  // v48.23（D61 §6.8-11）：多段选择的修饰键（app.multiSelectKey；默认 Ctrl / macOS 建议 Meta）
  const [multiKey, setMultiKey] = useState<MultiSelectKey | null>(null);
  // 批 4（规格 §9.2）：就地批注四键——读侧统一走 lib/annotationSettings（与两宿主同一份归一）
  const [annot, setAnnot] = useState<AnnotationSettings>(DEFAULT_ANNOT_SETTINGS);
  // D95 §E/§F：摘录卡编辑器工具栏 + 字号/字体键（读侧同一份归一；写侧 main.js settings:set 再归一一次）
  const [ext, setExt] = useState<ExtractCardSettings>({
    extractEditorToolbar: DEFAULT_EXTRACT_EDITOR_TOOLBAR,
    extractEditorToolbarFloat: DEFAULT_EXTRACT_EDITOR_TOOLBAR_FLOAT,
    extractEditorToolbarTop: DEFAULT_EXTRACT_EDITOR_TOOLBAR_TOP,
    extractFaceFontFollow: DEFAULT_EXTRACT_FACE_FONT_FOLLOW,
    extractFaceFontSize: DEFAULT_EXTRACT_FACE_FONT_SIZE,
    extractFaceFontFamily: DEFAULT_EXTRACT_FACE_FONT_FAMILY
  });
  // D122：选区浮条动作呈现（icon 图标 / text 文字）
  const [selBarStyle, setSelBarStyle] = useState<SelectionBarStyle>(DEFAULT_SELECTION_BAR_STYLE);
  // D130 R3 P1：主题管理就地表——重命名（行内输入，失焦落库）与删除（就地二次确认，焦点默认落「取消」）
  const [renameId, setRenameId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  useEffect(() => {
    settingsStore
      .get<unknown>("app", "readerSettings", null)
      .then((s) => setCfg(normalizeReaderSettings(s)))
      .catch(() => setCfg(normalizeReaderSettings(null)));
    void readMultiSelectKey().then(setMultiKey);
    void readAnnotationSettings().then(setAnnot);
    void readExtractCardSettings().then(setExt);
    void settingsStore
      .get<unknown>("app", "selectionBarStyle", DEFAULT_SELECTION_BAR_STYLE)
      .then((v) => setSelBarStyle(normalizeSelectionBarStyle(v)));
  }, []);
  // D130 R3：阅读器快捷菜单对同一键的写入经 settings/changed 回灌——滑杆与快捷菜单双向即时一致
  useEffect(() => {
    return eventBus.on("settings/changed", (p) => {
      const payload = p as { scope?: string; key?: string } | undefined;
      if (payload?.scope !== "app" || payload.key !== "readerSettings") return;
      void settingsStore
        .get<unknown>("app", "readerSettings", null)
        .then((s) => setCfg(normalizeReaderSettings(s)))
        .catch(() => {});
    });
  }, []);
  const save = (next: ReaderSettings) => {
    setCfg(next);
    void settingsStore.set("app", "readerSettings", next);
  };
  const saveMultiKey = (key: MultiSelectKey) => {
    setMultiKey(key);
    void settingsStore.set("app", "multiSelectKey", key);
  };
  /** D95：写摘录卡键（键名用显式字面量——f18 消费者扫描器按常量名反查，见 annotationSettings 同款注释） */
  const saveExtract = (next: ExtractCardSettings) => {
    setExt(next);
    void settingsStore.set("app", "extractEditorToolbar", next.extractEditorToolbar);
    void settingsStore.set("app", "extractEditorToolbarFloat", next.extractEditorToolbarFloat);
    void settingsStore.set("app", "extractEditorToolbarTop", next.extractEditorToolbarTop);
    void settingsStore.set("app", "extractFaceFontFollow", next.extractFaceFontFollow);
    void settingsStore.set("app", "extractFaceFontSize", next.extractFaceFontSize);
    void settingsStore.set("app", "extractFaceFontFamily", next.extractFaceFontFamily);
  };
  /** 写单键：本地态先动（UI 即时），主进程写侧还会再归一一次 */
  const saveAnnot = <K extends keyof AnnotationSettings>(key: K, value: AnnotationSettings[K]) => {
    setAnnot((prev) => ({ ...prev, [key]: value }));
    void writeAnnotationSetting(key, value);
  };
  // ---------- D130 R3 P1：我的主题管理（重命名/删除只在设置页——progressive disclosure） ----------
  const renameTheme = (id: string, name: string) => {
    if (!cfg) return;
    const trimmed = name.trim().slice(0, 24);
    if (!trimmed) return; // 空名不落库（保留原名；归一口同样截 24 字符）
    save({ ...cfg, customThemes: (cfg.customThemes ?? []).map((t) => (t.id === id ? { ...t, name: trimmed } : t)) });
  };
  const deleteTheme = (id: string) => {
    if (!cfg) return;
    // 删除当前正在使用的主题：外观保持不变（theme=custom + 色值仍在 appearance 上）——
    // 主题列表只是速记本，不联动清色（行为可预期，设计稿 §4.1）
    save({ ...cfg, customThemes: (cfg.customThemes ?? []).filter((t) => t.id !== id) });
  };
  const fmtDate = (ts: number) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  if (!cfg) return null;
  const a = cfg.appearance;
  return (
    <SettingsSection id="sec-reader" title={T("阅读")}>
      <h4>{T("阅读外观")}</h4>
      <div className="settings-row">
        <span className="settings-row-label">
          {T("主题预设")}
          <SettingsInfo label={T("主题预设")}>{T("与阅读器顶栏「主题」菜单读写同一份设置。")}</SettingsInfo>
        </span>
        <div className="seg-tabs">
          {(["paper", "sepia", "dark", "custom"] as const).map((t) => (
            <button key={t} className={a.theme === t ? "active" : ""} onClick={() => save({ ...cfg, appearance: { ...a, theme: t } })}>
              {t === "paper" ? T("纸白") : t === "sepia" ? T("羊皮") : t === "dark" ? T("暗夜") : T("自定义")}
            </button>
          ))}
        </div>
      </div>
      {a.theme === "custom" && (
        <div className="settings-row">
          <span>{T("自定义色")}</span>
          <input type="color" value={a.bgColor || "#fafaf8"} onChange={(e) => save({ ...cfg, appearance: { ...a, bgColor: e.target.value } })} title={T("背景色")} />
          <input type="color" value={a.fgColor || "#1a1a1a"} onChange={(e) => save({ ...cfg, appearance: { ...a, fgColor: e.target.value } })} title={T("文字色")} />
        </div>
      )}
      <div className="settings-row">
        <span>{T("字号（{n}px）", { n: a.fontSize ?? 17 })}</span>
        <input
          type="range"
          min={12}
          max={32}
          value={a.fontSize ?? 17}
          onChange={(e) => save({ ...cfg, appearance: { ...a, fontSize: Number(e.target.value) } })}
        />
      </div>
      <div className="form-field">
        <label>{T("正文字体")}</label>
        <input
          value={a.fontFamily ?? ""}
          placeholder={T("留空使用默认多语言衬线栈")}
          onChange={(e) => save({ ...cfg, appearance: { ...a, fontFamily: e.target.value } })}
        />
      </div>
      {/* D130 R3 P2/P3：行距（既有字段接 UI）+ 页边距 + 版心宽度——与阅读器快捷菜单读写同一字段；
          数值显示 mono + tabular-nums（.mono 的 font-feature-settings "tnum"），拖动时数字宽度不跳动 */}
      <div className="settings-row" data-reader-setting="lineHeight">
        <span className="settings-row-label">
          {T("行距（")}
          <span className="mono">{a.lineHeight ?? 1.7}</span>
          {T("）")}
          <SettingsInfo label={T("行距")}>{T("正文行距（1.2–2.4）。摘录卡面行高恒跟随本设置（既有契约）；PDF 为固定版式，不适用。")}</SettingsInfo>
        </span>
        <input
          type="range"
          min={1.2}
          max={2.4}
          step={0.1}
          value={a.lineHeight ?? 1.7}
          onChange={(e) => save({ ...cfg, appearance: { ...a, lineHeight: Number(e.target.value) } })}
        />
      </div>
      <div className="settings-row" data-reader-setting="margin">
        <span className="settings-row-label">
          {T("页边距（")}
          <span className="mono">{a.margin ?? 48}px</span>
          {T("）")}
          <SettingsInfo label={T("页边距")}>{T("分页/对开模式的上下边带（0–120px）；滚动模式的排版余白由版心宽度承担；PDF 不适用。")}</SettingsInfo>
        </span>
        <input
          type="range"
          min={0}
          max={120}
          step={4}
          value={a.margin ?? 48}
          onChange={(e) => save({ ...cfg, appearance: { ...a, margin: Number(e.target.value) } })}
        />
      </div>
      <div className="settings-row" data-reader-setting="measure">
        <span className="settings-row-label">
          {T("版心宽度（")}
          <span className="mono">{a.maxInlineSize ?? 720}px</span>
          {T("）")}
          <SettingsInfo label={T("版心宽度")}>{T("滚动模式正文列最大宽度（480–1200px）＝「页边距」在滚动模式的对应物；720px ≈ 每行 42 个全角字。")}</SettingsInfo>
        </span>
        <input
          type="range"
          min={480}
          max={1200}
          step={20}
          value={a.maxInlineSize ?? 720}
          onChange={(e) => save({ ...cfg, appearance: { ...a, maxInlineSize: Number(e.target.value) } })}
        />
      </div>

      {/* D130 R3 P1：我的主题管理（行 hover 出操作、hairline 分隔；删除走就地二次确认，焦点默认落「取消」） */}
      <h4>我的主题</h4>
      {(cfg.customThemes ?? []).length > 0 ? (
        <div className="reader-theme-manage-list" data-reader-theme-manage-list>
          {(cfg.customThemes ?? []).map((t: CustomThemeEntry) => (
            <div className="reader-theme-manage-row" key={t.id} data-reader-theme-id={t.id}>
              <span className="reader-theme-swatch" style={{ background: t.bgColor }} aria-hidden="true" />
              {renameId === t.id ? (
                <input
                  className="reader-theme-rename-input"
                  defaultValue={t.name}
                  maxLength={24}
                  autoFocus
                  aria-label={T("重命名主题")}
                  onBlur={(e) => {
                    renameTheme(t.id, e.target.value);
                    setRenameId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      renameTheme(t.id, (e.target as HTMLInputElement).value);
                      setRenameId(null);
                    } else if (e.key === "Escape") setRenameId(null);
                  }}
                />
              ) : (
                <span className="reader-theme-manage-name" title={t.name}>
                  {t.name}
                </span>
              )}
              <span className="reader-theme-manage-date mono">{fmtDate(t.createdAt)}</span>
              {confirmId === t.id ? (
                /* D130 R3 实跑修正：key 强制换子树 remount——React 会就地把普通态 span 复用为确认态
                   （同为 span、子按钮同位复用），autoFocus 只在 mount 时生效，不 remount 焦点永不落
                   「取消」（设计 §6「焦点默认落取消」契约落空）。 */
                <span key="confirm" className="reader-theme-manage-actions reader-theme-manage-actions-show">
                  <button type="button" className="reader-text-btn" data-reader-theme-delete-confirm onClick={() => { deleteTheme(t.id); setConfirmId(null); }}>
                    {T("确认删除")}
                  </button>
                  <button type="button" className="reader-text-btn" autoFocus onClick={() => setConfirmId(null)}>
                    {T("取消")}
                  </button>
                </span>
              ) : (
                <span className="reader-theme-manage-actions">
                  <button type="button" className="reader-text-btn" data-reader-theme-rename onClick={() => setRenameId(t.id)}>
                    {T("重命名")}
                  </button>
                  <button type="button" className="reader-text-btn" data-reader-theme-delete onClick={() => setConfirmId(t.id)}>
                    {T("删除")}
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="reader-theme-empty">{T("在阅读器里把自定义色保存为主题后，会出现在这里。")}</p>
      )}

      <h4>{T("选区与批注")}</h4>
      <div className="settings-row">
        <span className="settings-row-label">
          {T("多段选择修饰键")}
          <SettingsInfo label={T("多段选择修饰键")}>{T("按住它再选不相邻段＝加选；重复选＝移出；Esc 清空。Ctrl+Z/X/S/A/D 等纯键盘组合不受影响。")}</SettingsInfo>
        </span>
        <Dropdown
          value={multiKey ?? DEFAULT_MULTI_SELECT_KEY}
          align="left"
          options={MULTI_SELECT_KEYS.map((k) => ({
            value: k,
            label: k === "Meta" ? T("Meta（macOS 的 Command）") : k
          }))}
          onChange={(v) => saveMultiKey(v as MultiSelectKey)}
        />
      </div>
      <div className="settings-row">
        <span className="settings-row-label">
          {T("默认标注模式")}
          <SettingsInfo label={T("默认标注模式")}>{T("高亮＝点色只做纯批注；摘录+高亮＝点色同时建一条摘录。都可在选区菜单里临时切换。")}</SettingsInfo>
        </span>
        <div className="seg-tabs">
          {([["highlight", "高亮"], ["extract", "摘录+高亮"]] as const).map(([id, label]) => (
            <button
              key={id}
              className={annot.annotateMode === id ? "active" : ""}
              data-annot-mode={id}
              onClick={() => saveAnnot("annotateMode", id)}
            >
              {T(label)}
            </button>
          ))}
        </div>
      </div>
      <div className="settings-row">
        <span className="settings-row-label">
          {T("默认标注形式")}
          <SettingsInfo label={T("默认标注形式")}>{T("高亮＝底色；下划线＝批注色 2px 色线。都可在选区菜单里临时切换。")}</SettingsInfo>
        </span>
        <div className="seg-tabs">
          {([["highlight", "高亮"], ["underline", "下划线"]] as const).map(([id, label]) => (
            <button
              key={id}
              className={annot.annotateForm === id ? "active" : ""}
              data-annot-form={id}
              onClick={() => saveAnnot("annotateForm", id)}
            >
              {T(label)}
            </button>
          ))}
        </div>
      </div>
      <div className="settings-row">
        <span className="settings-row-label">
          {T("批注色板")}
          <SettingsInfo label={T("批注色板")}>{T("勾选的颜色与顺序＝调色排里出现的颜色与顺序；点色即执行当前模式的动作。")}</SettingsInfo>
        </span>
        <div className="annot-palette-pick" data-annot-palette>
          {ANNOT_COLORS.map((c) => {
            const on = annot.annotatePalette.includes(c);
            return (
              <button
                key={c}
                type="button"
                className={`swatch${on ? " on" : ""}`}
                data-palette-color={c}
                aria-pressed={on}
                title={on ? T("{c}（点击移出色板）", { c }) : T("{c}（点击加入色板，最多 8 支）", { c })}
                style={{ background: `var(--annot-${c})` }}
                onClick={() => saveAnnot("annotatePalette", togglePaletteColor(annot.annotatePalette, c))}
              />
            );
          })}
        </div>
      </div>
      <div className="settings-row">
        <span className="settings-row-label">
          {T("自定义取色")}
          <SettingsInfo label={T("自定义取色")}>{T("调色排末位是否显示「自定义…」入口。")}</SettingsInfo>
        </span>
        <div className="seg-tabs">
          {([[true, "显示"], [false, "隐藏"]] as const).map(([id, label]) => (
            <button
              key={String(id)}
              className={annot.annotateCustomEnabled === id ? "active" : ""}
              data-annot-custom={String(id)}
              onClick={() => saveAnnot("annotateCustomEnabled", id)}
            >
              {T(label)}
            </button>
          ))}
        </div>
      </div>
      <div className="settings-row">
        <span className="settings-row-label">
          {T("批注栏默认筛选")}
          <SettingsInfo label={T("批注栏默认筛选")}>{T("批注栏打开时的初始筛选；栏顶段控与本键同一份设置。")}</SettingsInfo>
        </span>
        <div className="seg-tabs">
          {([["all", "全部"], ["extract", "摘录"], ["highlight", "高亮"]] as const).map(([id, label]) => (
            <button
              key={id}
              className={annot.annotationFilter === id ? "active" : ""}
              data-annot-filter={id}
              onClick={() => saveAnnot("annotationFilter", id)}
            >
              {T(label)}
            </button>
          ))}
        </div>
      </div>
      {/* D122：选区浮条里「批注/制卡/AI 制卡/AI 解释/查词」的呈现——图标（默认）或文字 */}
      <div className="settings-row">
        <span className="settings-row-label">
          {T("选区浮条按钮样式")}
          <SettingsInfo label={T("选区浮条按钮样式")}>{T("选中文字时出现在文字旁的浮条里，动作按钮用图标（悬停显示名称）或文字标签。")}</SettingsInfo>
        </span>
        <div className="seg-tabs">
          {([["icon", "图标"], ["text", "文字"]] as const).map(([id, label]) => (
            <button
              key={id}
              className={selBarStyle === id ? "active" : ""}
              data-sel-bar-style={id}
              data-testid={`setting-sel-bar-style-${id}`}
              onClick={() => {
                setSelBarStyle(id);
                void settingsStore.set("app", "selectionBarStyle", id);
              }}
            >
              {T(label)}
            </button>
          ))}
        </div>
      </div>

      <h4>{T("摘录卡编辑器")}</h4>
      {/* D95 §E：编辑器富文本工具栏开关（v48.114 / D160 全局化：MarkdownEditor 组件内读键 ⇒ 全部带工具条的
          编辑宿主一并生效——摘录卡、书架粘贴导入等；关＝整行不渲染，markdown 语法输入不受影响） */}
      <div className="settings-row">
        <span className="settings-row-label">
          {T("编辑器富文本工具栏")}
          <SettingsInfo label={T("编辑器富文本工具栏")}>
            {T("全局生效：摘录卡、书架「添加书籍」粘贴导入等所有 Markdown 编辑面的底部工具条。编辑时选中文字即可加粗/标题/列表/公式等；关闭后仍可用 markdown 语法输入与快捷键。")}
          </SettingsInfo>
        </span>
        <label className="widget-toggle-main">
          <input
            type="checkbox"
            data-testid="setting-extract-editor-toolbar"
            checked={ext.extractEditorToolbar}
            onChange={(e) => saveExtract({ ...ext, extractEditorToolbar: e.target.checked })}
          />
          <span>{T("编辑时显示")}</span>
        </label>
      </div>
      {/* D95 v1.4→§K.3：工具栏形态——dock（钉底/钉顶）/悬浮＝选区锚定弹层 */}
      <div className="settings-row">
        <span className="settings-row-label">
          {T("工具栏形态")}
          <SettingsInfo label={T("工具栏形态")}>{T("悬浮＝工具条弹层锚定当前选中的文字；关闭＝随文档流固定在顶部或底部。")}</SettingsInfo>
        </span>
        <label className="widget-toggle-main">
          <input
            type="checkbox"
            data-testid="setting-extract-editor-toolbar-float"
            checked={ext.extractEditorToolbarFloat}
            onChange={(e) => saveExtract({ ...ext, extractEditorToolbarFloat: e.target.checked })}
          />
          <span>{T("悬浮于选中文字")}</span>
        </label>
      </div>
      {/* §K.2：dock 态钉底/钉顶（悬浮态优先于本键；钉顶时工具条吸顶并让开吸顶头带） */}
      <div className="settings-row">
        <span className="settings-row-label">
          {T("工具栏固定位置（非悬浮时）")}
          <SettingsInfo label={T("工具栏固定位置")}>{T("开启＝钉顶（吸顶并让开吸顶头带）；关闭＝钉底。悬浮形态优先于本键。")}</SettingsInfo>
        </span>
        <label className="widget-toggle-main">
          <input
            type="checkbox"
            data-testid="setting-extract-editor-toolbar-top"
            checked={ext.extractEditorToolbarTop}
            onChange={(e) => saveExtract({ ...ext, extractEditorToolbarTop: e.target.checked })}
          />
          <span>{T("固定在顶部")}</span>
        </label>
      </div>
      {/* D95 §F.2：摘录卡字号——默认跟随阅读界面，可独立自定义字号/字体（行高恒跟随） */}
      <div className="settings-row">
        <span>{T("摘录卡字号")}</span>
        <label className="widget-toggle-main">
          <input
            type="checkbox"
            data-testid="setting-extract-font-follow"
            checked={ext.extractFaceFontFollow}
            onChange={(e) => saveExtract({ ...ext, extractFaceFontFollow: e.target.checked })}
          />
          <span>{T("跟随阅读界面字号/字体")}</span>
        </label>
      </div>
      {!ext.extractFaceFontFollow && (
        <>
          <div className="settings-row">
            <span>{T("摘录卡字号（{n}px）", { n: ext.extractFaceFontSize })}</span>
            <input
              type="range"
              min={10}
              max={40}
              data-testid="setting-extract-font-size"
              value={ext.extractFaceFontSize}
              onChange={(e) => saveExtract({ ...ext, extractFaceFontSize: Number(e.target.value) })}
            />
          </div>
          <div className="form-field">
            <label>{T("摘录卡字体")}</label>
            <input
              data-testid="setting-extract-font-family"
              value={ext.extractFaceFontFamily}
              placeholder={T("留空使用应用默认字体")}
              onChange={(e) => saveExtract({ ...ext, extractFaceFontFamily: e.target.value })}
            />
          </div>
        </>
      )}
    </SettingsSection>
  );
}

// ---------- M2 备份与恢复（§9.1 M2）：手动备份/恢复 + 每日首启自动滚动备份 ----------
type BackupCounts = { items: number; cards: number; extracts: number; assets: number };
interface BackupInfo {
  dbBytes: number;
  assetFiles: number;
  assetBytes: number;
  counts: BackupCounts;
  backupDir: string;
}
interface BackupEntry {
  file: string;
  path: string;
  label: string;
  createdAt: number;
  includesAIConfig: boolean;
  counts: BackupCounts | null;
  assetFiles: number | null;
  sizeBytes: number;
  valid: boolean;
}

function backupAPI() {
  return (window as unknown as {
    backupAPI?: {
      info: () => Promise<BackupInfo>;
      create: (opts: { includeAIConfig: boolean }) => Promise<{ ok: boolean; file?: string; error?: string; skipped?: boolean }>;
      list: () => Promise<{ backupDir: string; backups: BackupEntry[] }>;
      pickDir: () => Promise<string | null>;
      openDir: () => Promise<boolean>;
      pickFile: () => Promise<string | null>;
      restore: (file: string) => Promise<{ ok: boolean; error?: string; needsRestart?: boolean; safetyFile?: string | null }>;
      relaunch: () => void;
    };
  }).backupAPI!;
}

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const BACKUP_LABEL: Record<string, string> = { manual: "手动", auto: "自动", safety: "安全" };

// ---------- 日志（v48.75 / D119，设计 docs/design/APP-LOGGING-D119.md）：诊断文件唯一入口 ----------
// logsAPI 访问（preload 暴露；局部断言，先例＝backupAPI）
function logsAPI() {
  return (window as unknown as {
    logsAPI?: { openFolder: () => Promise<boolean> };
  }).logsAPI!;
}

function LogsSection() {
  const T = useT();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  async function openFolder() {
    try {
      const ok = await logsAPI().openFolder();
      setNotice(
        ok
          ? { ok: true, text: T("已在系统文件管理器中打开日志文件夹。") }
          : { ok: false, text: T("打开日志文件夹失败，请重试。") }
      );
    } catch (err) {
      setNotice({ ok: false, text: T("打开日志文件夹失败：{msg}", { msg: err instanceof Error ? err.message : String(err) }) });
    }
  }
  return (
    <SettingsSection id="sec-logs" title={T("日志")}>
      <p className="form-hint">
        {T("软件运行与错误信息记录在本地日志文件中（只含时间、错误消息与运行状态，不含书籍内容）。遇到问题时，可将日志文件发送给开发者协助排查。")}
      </p>
      <div className="settings-row">
        <button className="btn btn-outline btn-sm" onClick={openFolder}>
          {T("打开日志文件夹")}
        </button>
      </div>
      {notice && <p className={notice.ok ? "ai-test-ok" : "ai-test-fail"}>{notice.text}</p>}
    </SettingsSection>
  );
}

// ---------- 软件更新（v49.6 / D180）：检查更新唯一 UI 入口（sec-updates） ----------
// 状态快照与事件同构自 electron/updater.js（update:status / update:event）；
// source 分流：github＝完整流程；store＝MSIX 包身份，商店托管更新（自更新禁用）；
// dev＝开发模式；unconfigured＝打包时未写入更新源（占位 slug）。
type UpdateSource = "github" | "store" | "dev" | "unconfigured";
type UpdateStateName =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "error";
interface UpdateInfoLite {
  version?: string;
  releaseName?: string;
  releaseDate?: string;
}
interface UpdateProgressLite {
  percent?: number;
  transferred?: number;
  total?: number;
  bytesPerSecond?: number;
}
interface UpdateSnapshot {
  source: UpdateSource;
  enabled: boolean;
  currentVersion: string;
  state: UpdateStateName;
  info: UpdateInfoLite | null;
  progress: UpdateProgressLite | null;
  error: string | null;
}
type UpdateEventPayload = {
  type: UpdateStateName;
  info: UpdateInfoLite | null;
  progress: UpdateProgressLite | null;
  error: string | null;
};

// preload 暴露（局部断言，先例＝backupAPI）
function updateAPI() {
  return (window as unknown as {
    updateAPI?: {
      status: () => Promise<UpdateSnapshot>;
      check: () => Promise<UpdateSnapshot>;
      download: () => Promise<UpdateSnapshot>;
      install: () => Promise<boolean>;
      onEvent: (cb: (e: UpdateEventPayload) => void) => () => void;
    };
  }).updateAPI!;
}

const UPDATE_SOURCE_HINT: Record<UpdateSource, string> = {
  github: "更新由 GitHub Releases 提供；发现新版本后需你确认才会下载与安装。",
  store: "当前版本由 Microsoft Store 安装，更新由商店自动管理，无需手动检查。",
  dev: "开发模式不检查更新。",
  unconfigured: "打包时未写入更新源（发布前需在 electron-builder.yml 填写 GitHub 仓库并重新打包）。"
};

function UpdateSection() {
  const T = useT();
  const [snap, setSnap] = useState<UpdateSnapshot | null>(null);
  const [autoOn, setAutoOn] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    const api = updateAPI();
    if (!api) return;
    void api.status().then((s) => {
      if (alive) setSnap(s);
    });
    void settingsStore.get<unknown>("app", "updateAutoCheck", true).then((v) => {
      if (alive) setAutoOn(v !== false);
    });
    const off = api.onEvent((e) => {
      if (!alive) return;
      setSnap((prev) =>
        prev
          ? { ...prev, state: e.type, info: e.info ?? prev.info, progress: e.progress, error: e.error }
          : prev
      );
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  if (!snap || autoOn === null) return null;

  const isGithub = snap.source === "github";
  const st = snap.state;

  // 状态行（github 渠道下随检查-下载状态机流转；其余渠道只显示说明）
  let statusLine = "";
  if (isGithub) {
    if (st === "checking") statusLine = T("正在检查更新…");
    else if (st === "not-available") statusLine = T("已是最新版本。");
    else if (st === "available") statusLine = T("发现新版本 v{version}，可下载安装。", { version: snap.info?.version ?? "?" });
    else if (st === "downloading")
      statusLine =
        snap.progress?.percent !== undefined && snap.progress.percent !== null
          ? T("正在下载更新… {pct}%", { pct: snap.progress.percent })
          : T("正在下载更新…");
    else if (st === "downloaded")
      statusLine = T("更新包已就绪（v{version}），重启后自动安装。", { version: snap.info?.version ?? "?" });
    else if (st === "error") statusLine = T("检查失败：{msg}", { msg: snap.error ?? T("未知错误") });
  }

  const checking = st === "checking";

  return (
    <SettingsSection id="sec-updates" title={T("软件更新")}>
      <p className="form-hint">
        {T("当前版本 v{version}。", { version: snap.currentVersion })}{T(UPDATE_SOURCE_HINT[snap.source])}
      </p>
      {isGithub && (
        <>
          <div className="settings-row">
            <span className="settings-row-label">
              {T("自动检查更新")}
              <SettingsInfo label={T("自动检查更新")}>
                {T("启动后联网查询 GitHub 最新发布版本（只检查、不下载）；关闭后不再自动检查，随时可在下方手动检查。检查请求不含任何个人数据。")}
              </SettingsInfo>
            </span>
            <div className="seg-tabs seg-tabs-sm" role="group" aria-label={T("自动检查更新")}>
              <button
                className={autoOn ? "active" : ""}
                onClick={() => {
                  setAutoOn(true);
                  void settingsStore.set("app", "updateAutoCheck", true);
                }}
              >
                {T("开启")}
              </button>
              <button
                className={!autoOn ? "active" : ""}
                onClick={() => {
                  setAutoOn(false);
                  void settingsStore.set("app", "updateAutoCheck", false);
                }}
              >
                {T("关闭")}
              </button>
            </div>
          </div>
          <div className="settings-row">
            <span className="settings-row-label">{statusLine}</span>
            {st === "available" ? (
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  void updateAPI().download();
                }}
              >
                {T("下载更新")}
              </button>
            ) : st === "downloaded" ? (
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  void updateAPI().install();
                }}
              >
                {T("重启并安装")}
              </button>
            ) : (
              <button
                className="btn btn-outline btn-sm"
                disabled={checking || st === "downloading"}
                onClick={() => {
                  void updateAPI().check();
                }}
              >
                {st === "downloading" ? T("下载中…") : checking ? T("检查中…") : T("检查更新")}
              </button>
            )}
          </div>
        </>
      )}
    </SettingsSection>
  );
}

// ---------- 关于（v49.7 / D181）：应用信息 + 开源许可清单 ----------
// 纯信息节：零设置键、零交互控件。许可清单为静态数据手工维护，口径＝运行时直接依赖
// （不列构建期工具与测试依赖）；许可类型以 node_modules 各包 package.json 实测为准；
// 不写版本号——版本随升级漂移，清单只固化「用了什么、什么许可」。版本号复用
// update:status 快照（currentVersion，真源 package.json version，D180），不新增 IPC。
const OSS_ITEMS: Array<{ name: string; license: string; note?: string }> = [
  { name: "Electron", license: "MIT", note: "应用框架（含 Chromium / Node.js）" },
  { name: "React · React DOM", license: "MIT", note: "界面框架" },
  { name: "better-sqlite3", license: "MIT", note: "SQLite 存储" },
  { name: "sql.js", license: "MIT", note: "SQLite（WASM）" },
  { name: "ts-fsrs", license: "MIT", note: "FSRS 调度内核" },
  { name: "fsrs-rs-nodejs", license: "MIT", note: "FSRS 参数优化（Rust）" },
  { name: "pdfjs-dist", license: "Apache-2.0", note: "PDF 引擎" },
  { name: "epub-ts", license: "BSD-2-Clause", note: "EPUB 解析（@likecoin/epub-ts）" },
  { name: "mammoth", license: "BSD-2-Clause", note: "Word 导入" },
  { name: "Readability", license: "Apache-2.0", note: "正文提取（@mozilla/readability）" },
  { name: "Milkdown", license: "MIT", note: "Markdown 编辑器 · 基于 ProseMirror（@milkdown/kit · @milkdown/react）" },
  { name: "react-markdown", license: "MIT", note: "Markdown 渲染（remark / rehype / unified 管线）" },
  { name: "markdown-it", license: "MIT", note: "Markdown 解析" },
  { name: "turndown", license: "MIT", note: "HTML → Markdown" },
  { name: "micromark-extension-mark", license: "ISC" },
  { name: "github-slugger", license: "ISC" },
  { name: "KaTeX", license: "MIT", note: "数学公式渲染" },
  { name: "DOMPurify", license: "MPL-2.0 / Apache-2.0", note: "HTML 净化" },
  { name: "JSZip", license: "MIT / GPL-3.0", note: "ZIP 处理" },
  { name: "electron-updater", license: "MIT", note: "检查更新" }
];

function AboutSection() {
  const T = useT();
  const [version, setVersion] = useState("");

  useEffect(() => {
    let alive = true;
    const api = updateAPI();
    void api
      .status()
      .then((s) => {
        if (alive) setVersion(s.currentVersion);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return (
    <SettingsSection id="sec-about" title={T("关于")}>
      <p className="form-hint">
        {T("增量阅读")}{version ? T(" · 版本 v{version}", { version }) : ""}
        <br />
        {T("本地优先的桌面渐进阅读学习软件：数据全部保存在本机；核心功能零网络、零账号，仅在显式配置 AI 服务或检查更新时联网。")}
      </p>
      <h4>{T("开源许可")}</h4>
      <p className="form-hint">{T("本应用构建于以下开源项目之上，感谢原作者与贡献者。")}</p>
      <ul className="oss-list">
        {OSS_ITEMS.map((it) => (
          <li key={it.name}>
            {/* 主行（名称 + 许可证两端对齐）+ meta 说明行——书架图注/批注条目同款两行语言 */}
            <span className="oss-head">
              <span className="oss-name">{it.name}</span>
              <span className="oss-lic">{it.license}</span>
            </span>
            {it.note && <span className="oss-note">{T(it.note)}</span>}
          </li>
        ))}
      </ul>
      <p className="form-hint oss-tail">
        {T("清单覆盖运行时直接依赖；各组件的完整许可证文本与版权声明，以其官方发布页为准。")}
      </p>
    </SettingsSection>
  );
}

function BackupSection() {
  const T = useT();
  const [info, setInfo] = useState<BackupInfo | null>(null);
  const [list, setList] = useState<{ backupDir: string; backups: BackupEntry[] } | null>(null);
  const [autoOn, setAutoOn] = useState(true);
  const [keep, setKeep] = useState(7);
  const [includeKey, setIncludeKey] = useState(false);
  const [busy, setBusy] = useState<"" | "backup" | "restore">("");
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmFile, setConfirmFile] = useState<{ path: string; name: string } | null>(null);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    reload();
    settingsStore.get<boolean>("app", "autoBackupEnabled", true).then(setAutoOn);
    settingsStore.get<number>("app", "autoBackupKeep", 7).then((v) => setKeep(Number(v) || 7));
  }, []);

  async function reload() {
    const api = backupAPI();
    if (!api) return;
    const [i, l] = await Promise.all([api.info(), api.list()]);
    setInfo(i);
    setList(l);
  }

  async function toggleAuto(on: boolean) {
    setAutoOn(on);
    await settingsStore.set("app", "autoBackupEnabled", on);
  }

  async function changeKeep(n: number) {
    const v = Math.max(1, Math.min(90, Math.round(n) || 7));
    setKeep(v);
    await settingsStore.set("app", "autoBackupKeep", v);
  }

  async function changeDir() {
    const dir = await backupAPI().pickDir();
    if (!dir) return;
    await settingsStore.set("app", "backupDir", dir);
    await reload();
  }

  async function doBackup() {
    setBusy("backup");
    setNotice(null);
    try {
      const r = await backupAPI().create({ includeAIConfig: includeKey });
      if (r.ok) {
        setNotice({
          ok: true,
          text: r.skipped ? T("今日自动备份已存在，无需重复。") : T("备份完成：{file}", { file: r.file?.split(/[\\/]/).pop() ?? "" })
        });
        await reload();
      } else {
        setNotice({ ok: false, text: T("备份失败：{msg}", { msg: r.error ?? "" }) });
      }
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : String(err) });
    }
    setBusy("");
  }

  async function doRestore() {
    if (!confirmFile) return;
    setBusy("restore");
    setNotice(null);
    try {
      const r = await backupAPI().restore(confirmFile.path);
      if (r.ok) {
        setRestored(true);
        setConfirmFile(null);
        setNotice({
          ok: true,
          text: T("恢复完成（当前数据已安全备份至 {file}）。重启应用后生效——重启前请勿继续使用软件。", { file: r.safetyFile?.split(/[\\/]/).pop() ?? "" })
        });
        await reload();
      } else {
        setNotice({ ok: false, text: T("恢复失败：{msg}", { msg: r.error ?? "" }) });
      }
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : String(err) });
    }
    setBusy("");
  }

  async function pickRestoreFile() {
    const file = await backupAPI().pickFile();
    if (!file) return;
    setConfirmFile({ path: file, name: file.split(/[\\/]/).pop() ?? file });
  }

  return (
    <SettingsSection id="sec-backup" title={T("数据备份与恢复")}>
      {info && (
        <p className="form-hint">
          {T("当前数据：")}{T("{n} 本书", { n: info.counts.items })} ·{" "}
          {T("{n} 张卡", { n: info.counts.cards })} ·{" "}
          {T("{n} 条摘录", { n: info.counts.extracts })}（{T("库")}{" "}
          <span className="mono">{fmtBytes(info.dbBytes)}</span>，{T("资产")}{" "}
          <span className="mono">{fmtBytes(info.assetBytes)}</span>）
        </p>
      )}

      <div className="backup-toolbar">
        <button className="btn btn-primary btn-sm" disabled={busy !== "" || restored} onClick={doBackup}>
          {busy === "backup" ? T("备份中…") : T("立即备份")}
        </button>
        <label className="backup-checkline">
          <input type="checkbox" checked={includeKey} onChange={(e) => setIncludeKey(e.target.checked)} />
          {T("包含 AI Key（ai-config.json，默认不备）")}
        </label>
        <button className="btn btn-outline btn-sm" onClick={() => backupAPI().openDir()}>{T("打开备份文件夹")}</button>
        <button className="btn btn-outline btn-sm" onClick={changeDir}>{T("更改备份位置")}</button>
      </div>
      {list && (
        <p className="form-hint settings-block">
          {T("备份位置：")}<span className="mono">{list.backupDir}</span>
        </p>
      )}

      <div className="backup-toolbar settings-block">
        <span className="backup-row-title">{T("每日首次启动自动备份")}</span>
        <div className="seg-tabs seg-tabs-sm" role="group" aria-label={T("自动备份开关")}>
          <button className={autoOn ? "active" : ""} onClick={() => toggleAuto(true)}>{T("开")}</button>
          <button className={!autoOn ? "active" : ""} onClick={() => toggleAuto(false)}>{T("关")}</button>
        </div>
        <span className="backup-row-title">{T("保留")}</span>
        <input
          className="mono input-num"
          type="number"
          min={1}
          max={90}
          value={keep}
          onChange={(e) => changeKeep(Number(e.target.value))}
        />
        <span className="backup-row-title">{T("份（超出删最旧）")}</span>
      </div>

      {confirmFile && (
        <div className="restore-confirm">
          <p className="restore-confirm-title">{T("确认恢复")}</p>
          <p className="form-hint">
            {T("将用「{name}」覆盖当前全部数据（书架、卡片、复习记录、摘录、设置）。恢复前会自动安全备份当前数据；完成后需重启应用生效，重启前请勿继续使用软件。", { name: confirmFile.name })}
          </p>
          <div className="settings-row">
            <button className="btn btn-danger btn-sm" disabled={busy !== ""} onClick={doRestore}>
              {busy === "restore" ? T("恢复中…") : T("确认恢复")}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setConfirmFile(null)} autoFocus>{T("取消")}</button>
          </div>
        </div>
      )}

      {notice && <p className={notice.ok ? "ai-test-ok" : "ai-test-fail"}>{notice.text}</p>}
      {restored && (
        <div className="settings-row settings-block">
          <button className="btn btn-primary btn-sm" onClick={() => backupAPI().relaunch()}>{T("重启应用")}</button>
        </div>
      )}

      {list && list.backups.length > 0 && (
        <div className="backup-list">
          {list.backups.map((b) => (
            <div className="backup-row" key={b.path}>
              <div className="backup-row-main">
                <span className="backup-row-title">
                  <span className="backup-tag">{T(BACKUP_LABEL[b.label] || b.label)}</span>
                  {fmtTime(b.createdAt)}
                  {b.includesAIConfig && T(" · 含 Key")}
                  {!b.valid && T(" · 清单损坏")}
                </span>
                <span className="backup-row-sub">
                  {fmtBytes(b.sizeBytes)}
                  {b.counts ? T(" · {items} 书 · {cards} 卡", { items: b.counts.items, cards: b.counts.cards }) : ""}
                  {typeof b.assetFiles === "number" ? T(" · {n} 资产", { n: b.assetFiles }) : ""}
                </span>
              </div>
              <button
                className="btn btn-danger-outline btn-sm"
                disabled={busy !== "" || restored}
                onClick={() => setConfirmFile({ path: b.path, name: b.file })}
              >
                {T("恢复")}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="settings-row settings-block">
        <button className="btn btn-danger-outline btn-sm" disabled={restored} onClick={pickRestoreFile}>
          {T("从备份文件恢复…")}
        </button>
      </div>
    </SettingsSection>
  );
}

// ---------- 词典与查词（v32，D31；v48.70/D114 由「词典/下载」改名）----------
function DictSection() {
  const T = useT();
  const [mode, setMode] = useState<"local" | "online" | "auto">("auto");
  const [fields, setFields] = useState<Record<string, boolean>>(DEFAULT_POPUP_FIELDS);
  const [audioSource, setAudioSource] = useState<"tts" | "online">("tts");
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [sources, setSources] = useState<{ id: string; name: string; format: string; lang?: string; enabled: number; entry_count: number }[]>([]);
  const [progress, setProgress] = useState<Record<string, { progress: number; state: string; count?: number }>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    settingsStore.get<string>("app", "dictMode", "auto").then((v) => {
      if (v === "local" || v === "online" || v === "auto") setMode(v);
    });
    settingsStore.get<Record<string, boolean>>("app", "dictPopupFields", DEFAULT_POPUP_FIELDS).then((v) => {
      setFields({ ...DEFAULT_POPUP_FIELDS, ...(v || {}) });
    });
    settingsStore.get<"tts" | "online">("app", "dictAudioSource", "tts").then((v) => {
      if (v === "tts" || v === "online") setAudioSource(v);
    });
    // v48.58（D99）：自动发音默认开（v32 追记六「默认关」作废；显式存过 false 的库不受影响）
    settingsStore.get<boolean>("app", "dictAutoSpeak", true).then((v) => setAutoSpeak(!!v));
    refreshSources();
    const off = window.dictAPI?.onDownloadProgress((msg) => {
      setProgress((p) => ({ ...p, [msg.id]: { progress: msg.progress, state: msg.state } }));
      if (msg.state === "done" || msg.state === "done-capped") {
        setBusy(null);
        setNotice(
          msg.state === "done-capped"
            ? T("词典已下载并建好索引（已索引 {n} 词条，达到安全上限有截断），选中单词即可查词", { n: msg.count ?? 0 })
            : T("词典已下载并建好索引（共 {n} 词条），选中单词即可查词（本地优先于在线超时）", { n: msg.count ?? 0 })
        );
        refreshSources();
      }
      if (msg.state === "saved") {
        setBusy(null);
        setNotice(T("文件已下载，但该格式暂不支持自动建索引（已存于 dicts 目录）"));
      }
      if (msg.state === "error") setBusy(null);
    });
    return off;
  }, []);

  async function refreshSources() {
    try {
      const list = (await window.dictAPI?.sources()) as typeof sources;
      setSources(Array.isArray(list) ? list : []);
    } catch { /* 忽略 */ }
  }

  async function changeMode(m: "local" | "online" | "auto") {
    setMode(m);
    await settingsStore.set("app", "dictMode", m);
  }

  async function toggleField(key: string) {
    const next = { ...fields, [key]: !fields[key] };
    setFields(next);
    await settingsStore.set("app", "dictPopupFields", next);
  }

  async function changeAudioSource(v: "tts" | "online") {
    setAudioSource(v);
    await settingsStore.set("app", "dictAudioSource", v);
  }

  async function changeAutoSpeak(v: boolean) {
    setAutoSpeak(v);
    await settingsStore.set("app", "dictAutoSpeak", v);
  }

  async function download(item: DictCatalogItem) {
    if (!window.dictAPI || busy) return;
    setBusy(item.id);
    setNotice(null);
    setProgress((p) => ({ ...p, [item.id]: { progress: 0, state: "downloading" } }));
    try {
      await window.dictAPI.download({ id: item.id, url: item.url, mirrorUrl: item.mirrorUrl, format: item.format, name: item.name });
    } catch (err) {
      setBusy(null);
      setProgress((p) => ({ ...p, [item.id]: { progress: 0, state: "error" } }));
      setNotice(err instanceof Error ? err.message : String(err));
    }
  }

  async function importLocal() {
    if (!window.dictAPI) return;
    const picked = await window.dictAPI.pickFile();
    if (!picked) return;
    setNotice(null);
    try {
      const r = await window.dictAPI.importFile(picked.path);
      setNotice(r ? T("已导入「{name}」（{n} 词条），可在阅读器选中查词", { name: r.name, n: r.count }) : T("导入取消"));
      refreshSources();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <SettingsSection id="sec-dict" title={T("词典与查词")}>
      <div className="settings-row">
        <span className="settings-row-label">
          {T("词典来源")}
          <SettingsInfo label={T("词典来源")}>{T("本地＝不联网；在线＝Free Dictionary / Jisho；自动＝在线优先，失败/超时回落本地。")}</SettingsInfo>
        </span>
        <div className="seg-tabs" role="radiogroup" aria-label={T("词典来源")}>
          {(["local", "online", "auto"] as const).map((m) => (
            <button key={m} className={mode === m ? "active" : ""} onClick={() => changeMode(m)}>
              {m === "local" ? T("本地词典") : m === "online" ? T("在线词典") : T("自动")}
            </button>
          ))}
        </div>
      </div>

      <h4>
        {T("弹窗显示字段")}
        <SettingsInfo label={T("弹窗显示字段")}>{T("默认开拼写/音标/发音/释义；例句关闭不影响原句保存与挖空卡。")}</SettingsInfo>
      </h4>
      <div className="settings-row check-row">
        {FIELD_LABELS.map((f) => (
          <label key={f.key} className="check-inline">
            <input type="checkbox" checked={!!fields[f.key]} onChange={() => toggleField(f.key)} />
            {T(f.label)}
          </label>
        ))}
      </div>

      <h4>{T("单词卡发音")}</h4>
      <div className="settings-row">
        <span className="settings-row-label">
          {T("发音来源")}
          <SettingsInfo label={T("发音来源")}>{T("TTS＝离线可用（Windows 需语言语音包）；在线＝真人音频，缺失时回落 TTS。")}</SettingsInfo>
        </span>
        <div className="seg-tabs" role="radiogroup" aria-label={T("发音来源")}>
          <button className={audioSource === "tts" ? "active" : ""} onClick={() => changeAudioSource("tts")}>{T("系统 TTS")}</button>
          <button className={audioSource === "online" ? "active" : ""} onClick={() => changeAudioSource("online")}>{T("在线音频")}</button>
        </div>
      </div>
      <div className="settings-row">
        <label className="check-inline">
          <input type="checkbox" checked={autoSpeak} onChange={(e) => changeAutoSpeak(e.target.checked)} />
          {T("自动发音（出到单词卡即朗读，无需手动点击）")}
        </label>
      </div>

      <h4>
        {T("一键下载")}
        <SettingsInfo label={T("一键下载")}>{T("版权不明的第三方包（StarDict 朗道/牛津等）仅本地导入；Wiktionary 全量仅在线 API。")}</SettingsInfo>
      </h4>
      {DICT_CATALOG.filter((c) => c.suitable === "download").map((c) => {
        const pg = progress[c.id];
        return (
          <div key={c.id} className="dict-catalog-row">
            <div>
              <div><strong>{c.name}</strong> <span className="mono">{T(c.estSizeLabel)}</span> <span className="dict-tag">{T(c.recommendLevel)}</span></div>
              <div className="form-hint">{T(c.desc)}{T(c.recommend)}（{c.license}，{T(c.updateFreq)}）</div>
              {pg && (pg.state === "downloading" || pg.state === "indexing") && (
                <div className="mono">
                  {pg.state === "downloading" ? T("下载中… {pct}%", { pct: pg.progress }) : T("建索引中… 已 {n} 词条（期间界面保持响应）", { n: pg.count ?? 0 })}
                </div>
              )}
            </div>
            <button className="btn btn-outline btn-sm" disabled={busy === c.id} onClick={() => download(c)}>
              {busy === c.id ? T("下载中…") : sources.some((s) => s.name === c.name) ? T("更新") : T("下载")}
            </button>
          </div>
        );
      })}
      <div className="settings-row">
        <button className="btn btn-outline btn-sm" onClick={importLocal}>{T("本地导入词典文件…")}</button>
      </div>

      {sources.length > 0 && (
        <>
          <h4>{T("已安装词典")}</h4>
          {sources.map((s) => (
            <div key={s.id} className="dict-catalog-row">
              <div>
                <strong>{s.name}</strong> <span className="mono">{s.format}{s.lang ? ` · ${s.lang}` : ""} · {T("{n} 词条", { n: s.entry_count })}</span>
                {Number(s.entry_count) === 0 && <div className="form-hint">{T("未建索引——点右侧「更新」重新下载解析，或删除后本地导入。")}</div>}
              </div>
              <div className="row-actions">
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => window.dictAPI?.toggleSource(s.id, !s.enabled).then(refreshSources)}
                >
                  {s.enabled ? T("停用") : T("启用")}
                </button>
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => window.dictAPI?.removeSource(s.id).then(refreshSources)}
                >
                  {T("删除")}
                </button>
              </div>
            </div>
          ))}
        </>
      )}
      {notice && <p className="form-hint">{notice}</p>}
    </SettingsSection>
  );
}

// ---------- M4 快捷键自定义（§9.1 M4）：键位捕获 + 冲突检测 + 恢复默认，落 settings.app.keybindings ----------
function ShortcutsSection() {
  const T = useT();
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [capturing, setCapturing] = useState<string | null>(null); // 正在捕获新键位的命令 id
  const [conflict, setConflict] = useState<{ id: string; with: string } | null>(null);
  const capturingRef = useRef<string | null>(null);
  capturingRef.current = capturing;

  useEffect(() => {
    commandRegistry.init().then(() => setBindings(commandRegistry.getAllBindings()));
  }, []);

  // 捕获期间抑制全局快捷键分发（否则捕获 "1" 时会给弹窗下层的复习卡真实评分）
  useEffect(() => {
    if (!capturing) return;
    commandRegistry.pushSuppress("kb-capture");
    return () => commandRegistry.popSuppress("kb-capture");
  }, [capturing]);

  // 键位捕获：按下任意组合键（Esc 取消）；纯修饰键继续等待；冲突拒绝保存
  useEffect(() => {
    if (!capturing) return;
    function onKey(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
      const target = capturingRef.current;
      if (!target) return;
      if (e.key === "Escape") {
        setCapturing(null);
        return;
      }
      const combo = eventToCombo(e);
      if (!combo) return;
      setCapturing(null);
      const hit = commandRegistry.conflictWith(combo, target);
      if (hit) {
        setConflict({ id: target, with: hit.title });
        return;
      }
      setConflict(null);
      void commandRegistry.setOverride(target, combo).then(() => setBindings(commandRegistry.getAllBindings()));
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing]);

  async function resetOne(id: string) {
    setConflict(null);
    await commandRegistry.setOverride(id, null);
    setBindings(commandRegistry.getAllBindings());
  }

  async function resetAllBindings() {
    setConflict(null);
    setCapturing(null);
    await commandRegistry.resetAll();
    setBindings(commandRegistry.getAllBindings());
  }

  const groups: Array<["阅读" | "复习", CommandDef[]]> = [
    ["阅读", commandRegistry.COMMANDS.filter((c) => c.scene === "阅读")],
    ["复习", commandRegistry.COMMANDS.filter((c) => c.scene === "复习")]
  ];

  return (
    <SettingsSection
      id="sec-shortcuts"
      title={T("快捷键")}
      info={
        <SettingsInfo label={T("快捷键")}>
          {T("点键位框后按新组合键（Esc 取消）；与其他动作冲突的键位不会被保存；输入框内的编辑键不受影响。")}
        </SettingsInfo>
      }
    >
      <div className="settings-row settings-block-b">
        <button className="btn btn-outline btn-sm" onClick={resetAllBindings}>{T("全部恢复默认")}</button>
      </div>
      <h4>{T("应用内快捷键")}</h4>
      {groups.map(([label, defs]) => (
        <div key={label} className="kb-group">
          <div className="kb-group-label mono">{T(label)}</div>
          {defs.map((def) => {
            const binding = bindings[def.id] ?? def.defaultKey;
            const customized = binding !== def.defaultKey;
            const conflictMsg = conflict?.id === def.id ? T("与「{title}」冲突", { title: conflict.with }) : null;
            return (
              <div className="kb-row" key={def.id}>
                <span className="kb-row-title">{T(def.title)}</span>
                {conflictMsg && <span className="kb-conflict">{conflictMsg}</span>}
                <button
                  className={`kb-key mono${capturing === def.id ? " capturing" : ""}`}
                  title={T("点击后按下新键位")}
                  onClick={() => { setConflict(null); setCapturing(def.id); }}
                >
                  {capturing === def.id ? T("按下新键…") : binding}
                </button>
                <button
                  className="btn btn-secondary btn-sm kb-reset"
                  disabled={!customized}
                  title={T("恢复默认键位")}
                  onClick={() => resetOne(def.id)}
                >
                  {T("恢复")}
                </button>
              </div>
            );
          })}
        </div>
      ))}
      {/* v48.70（D114）：「全局快捷键」并入本节；子块根元素保留 id sec-global（m8 直达定位） */}
      <GlobalShortcutsBlock />
    </SettingsSection>
  );
}

// ---------- v36（M8-A，§5.4 / D34）：全局快捷键组 + 随系统启动 ----------
// v48.114（D159）：快速记录行与「失焦自动隐藏」子行随功能暂时移除（配置形状 quickCapture 字段保留，
// 主进程 readShortcutConfig 闸下强制关闭）；「添加学习材料」「制卡台」两行不受影响。
// 三条纪律：① 注册失败必须可见（`globalShortcut.register` 被占用时返回 false，静默失效最伤用户）；
// ② 键位候选要与应用内键位（CommandRegistry）及另一全局键互不冲突——全局键会在**系统层**吞掉按键，
//    否则「设置里看着没问题、应用内动作却静默失效」；
// ③ 无修饰键一律拒绝（单键全局快捷键会吞掉正常输入）。

interface GlobalShortcutsConfig {
  quickCapture: { enabled: boolean; accelerator: string; hideOnBlur: boolean };
  addMaterial: { enabled: boolean; accelerator: string };
  /** D123：独立制卡台窗口 */
  workbench: { enabled: boolean; accelerator: string };
  autoLaunch: boolean;
}

const DEFAULT_GLOBAL_SHORTCUTS: GlobalShortcutsConfig = {
  quickCapture: { enabled: true, accelerator: "Ctrl+Alt+Space", hideOnBlur: true },
  addMaterial: { enabled: true, accelerator: "Ctrl+Alt+N" },
  workbench: { enabled: true, accelerator: "Ctrl+Alt+K" },
  autoLaunch: false
};

type GlobalTarget = "quickCapture" | "addMaterial" | "workbench";

function shortcutStateLabel(s: { enabled: boolean; registered: boolean; error: string | null } | undefined, T: (k: string) => string): {
  text: string;
  cls: string;
} {
  if (!s) return { text: "—", cls: "" };
  if (!s.enabled) return { text: T("已关闭"), cls: "" };
  if (s.registered) return { text: T("已注册"), cls: " on" };
  return { text: s.error ? T("被占用") : T("未注册"), cls: " err" };
}

// D123：关闭主窗口＝收进系统托盘（默认开）；关闭则点关闭按钮直接退出应用
function TrayRow() {
  const T = useT();
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    void settingsStore.get<unknown>("app", "closeToTray", true).then((v) => setOn(v !== false));
  }, []);
  if (on === null) return null;
  return (
    <div className="kb-row">
      <label className="kb-row-title gs-check">
        <input
          type="checkbox"
          data-close-to-tray
          checked={on}
          onChange={(e) => {
            setOn(e.target.checked);
            void settingsStore.set("app", "closeToTray", e.target.checked);
          }}
        />
        {T("关闭窗口时收进系统托盘继续运行（托盘菜单「退出」才真正退出）")}
      </label>
    </div>
  );
}

function GlobalShortcutsBlock() {
  const T = useT();
  const [cfg, setCfg] = useState<GlobalShortcutsConfig>(DEFAULT_GLOBAL_SHORTCUTS);
  const [status, setStatus] = useState<ShortcutStatus | null>(null);
  const [capturing, setCapturing] = useState<GlobalTarget | null>(null);
  const [conflict, setConflict] = useState<{ target: GlobalTarget; message: string } | null>(null);
  const capturingRef = useRef<GlobalTarget | null>(null);
  capturingRef.current = capturing;
  const cfgRef = useRef<GlobalShortcutsConfig>(DEFAULT_GLOBAL_SHORTCUTS);
  cfgRef.current = cfg;

  useEffect(() => {
    void (async () => {
      await commandRegistry.init();
      const saved = await settingsStore.get<Partial<GlobalShortcutsConfig>>("app", "globalShortcuts", {});
      const next: GlobalShortcutsConfig = {
        quickCapture: { ...DEFAULT_GLOBAL_SHORTCUTS.quickCapture, ...(saved.quickCapture || {}) },
        addMaterial: { ...DEFAULT_GLOBAL_SHORTCUTS.addMaterial, ...(saved.addMaterial || {}) },
        workbench: { ...DEFAULT_GLOBAL_SHORTCUTS.workbench, ...(saved.workbench || {}) },
        autoLaunch: saved.autoLaunch === true
      };
      setCfg(next);
      setStatus(await shortcutsApi.status());
    })();
  }, []);

  // 捕获期间抑制应用内键位分发（否则捕获 "1" 会给弹窗下层的复习卡评分）
  useEffect(() => {
    if (!capturing) return;
    commandRegistry.pushSuppress("global-kb-capture");
    return () => commandRegistry.popSuppress("global-kb-capture");
  }, [capturing]);

  async function persist(next: GlobalShortcutsConfig, target?: GlobalTarget) {
    setCfg(next);
    await settingsStore.set("app", "globalShortcuts", next); // 主进程 settings:set 会即时重注册
    const st = await shortcutsApi.status();
    setStatus(st);
    if (target && st) {
      const err = st[target].error;
      if (err) setConflict({ target, message: err });
    }
  }

  useEffect(() => {
    if (!capturing) return;
    function onKey(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
      const target = capturingRef.current;
      if (!target) return;
      if (e.key === "Escape") {
        setCapturing(null);
        setConflict(null);
        return;
      }
      const combo = eventToCombo(e);
      if (!combo) return;
      const isFnKey = /^F([1-9]|1[0-9]|2[0-4])$/.test(combo);
      if (!combo.includes("+") && !isFnKey) {
        setConflict({ target, message: T("需带 Ctrl / Alt / Shift 修饰键（或使用 F1–F24）") });
        return;
      }
      setCapturing(null);
      const current = cfgRef.current;
      const others = (["quickCapture", "addMaterial", "workbench"] as const)
        .filter((k) => k !== target)
        .map((k) => current[k].accelerator);
      if (others.includes(combo)) {
        setConflict({ target, message: T("与另一个全局快捷键相同") });
        return;
      }
      const hit = commandRegistry.conflictWith(combo, "");
      if (hit) {
        setConflict({ target, message: T("与应用内「{title}」冲突", { title: hit.title }) });
        return;
      }
      setConflict(null);
      const next: GlobalShortcutsConfig = { ...current, [target]: { ...current[target], accelerator: combo } };
      void persist(next, target);
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing]);

  const add = shortcutStateLabel(status?.addMaterial, T);
  const wbs = shortcutStateLabel(status?.workbench, T);

  function renderKeyButton(target: GlobalTarget, enabled: boolean) {
    const binding = cfg[target].accelerator;
    const isDefault = binding === DEFAULT_GLOBAL_SHORTCUTS[target].accelerator;
    const reset = () => {
      const current = cfgRef.current;
      const next: GlobalShortcutsConfig = {
        ...current,
        [target]: { ...current[target], accelerator: DEFAULT_GLOBAL_SHORTCUTS[target].accelerator }
      };
      setConflict(null);
      void persist(next, target);
    };
    return (
      <>
        <button
          className={`kb-key mono${capturing === target ? " capturing" : ""}`}
          title={enabled ? T("点击后按下新组合键") : T("该快捷键已关闭")}
          disabled={!enabled}
          onClick={() => {
            setConflict(null);
            setCapturing(target);
          }}
        >
          {capturing === target ? T("按下新键…") : binding}
        </button>
        <button className="btn btn-secondary btn-sm kb-reset" disabled={isDefault} title={T("恢复默认")} onClick={reset}>
          {T("恢复")}
        </button>
      </>
    );
  }

  return (
    <div id="sec-global">
      <h4>
        {T("全局快捷键")}
        <SettingsInfo label={T("全局快捷键")}>
          {T("软件无焦点时也生效（需运行中，可配合「随系统启动」）；状态「被占用」＝系统层冲突，换一个组合即可。")}
        </SettingsInfo>
      </h4>

      <div className="kb-group">
        {/* v48.114（D159）：快速记录行与「失焦自动隐藏」子行随功能暂时移除（配置字段与主进程闸保留，重实装时回插） */}

        <div className="kb-row">
          <label className="kb-row-title gs-check">
            <input
              type="checkbox"
              checked={cfg.addMaterial.enabled}
              onChange={(e) => void persist({ ...cfg, addMaterial: { ...cfg.addMaterial, enabled: e.target.checked } })}
            />
            {T("添加学习材料（弹出「添加书籍」）")}
          </label>
          {conflict?.target === "addMaterial" && <span className="kb-conflict">{conflict.message}</span>}
          {renderKeyButton("addMaterial", cfg.addMaterial.enabled)}
          <span className={`gs-state mono${add.cls}`}>{add.text}</span>
        </div>

        <div className="kb-row">
          <label className="kb-row-title gs-check">
            <input
              type="checkbox"
              checked={cfg.workbench.enabled}
              onChange={(e) => void persist({ ...cfg, workbench: { ...cfg.workbench, enabled: e.target.checked } })}
            />
            {T("制卡台（弹出独立窗口：手动制卡 / AI 制卡 / AI 解释）")}
          </label>
          {conflict?.target === "workbench" && <span className="kb-conflict">{conflict.message}</span>}
          {renderKeyButton("workbench", cfg.workbench.enabled)}
          <span className={`gs-state mono${wbs.cls}`}>{wbs.text}</span>
        </div>

        <div className="kb-row">
          <label className="kb-row-title gs-check">
            <input
              type="checkbox"
              checked={cfg.autoLaunch}
              onChange={(e) => void persist({ ...cfg, autoLaunch: e.target.checked })}
            />
            {T("随系统启动（开机自动运行，保证全局快捷键随时可用）")}
          </label>
          <span className={`gs-state mono${status?.autoLaunch ? " on" : ""}`}>
            {status?.autoLaunch ? T("已开启") : T("已关闭")}
          </span>
        </div>
      </div>

      <TrayRow />

      <div className="settings-row settings-block">
        {/* v48.114（D159）：「试一下快速记录」随功能暂时移除（shortcutsApi.toggleCapture 保留在 lib/journal.ts） */}
        <button className="btn btn-outline btn-sm" onClick={() => void window.windowAPI?.workbench?.("toggle")}>
          {T("试一下制卡台窗口")}
        </button>
      </div>
    </div>
  );
}

// ---------- 主题插件（v48.89 / D132，设计 docs/design/PLUGIN-SYSTEM-D132.md §8）：sec-appearance 子块 ----------
// 插件来自 <userData>/plugins/ 文件夹（宿主 fail-closed 校验），本期仅支持主题（type:theme）；
// 启用 = 激活为当前主题（与内置皮肤双槽互斥，激活一方清另一方）；可调项值落 settingsStore
// 的 `plugin.<id>` 层唯一键 `values`，改动经 settings/changed → 注入链重拉即时生效（§5.3）。
// 无「卸载」钮（§2.2 第 7 条：删除由用户在文件管理器完成，删后重新扫描即消失）。
interface PluginSettingDef {
  id: string;
  name: string;
  type: "toggle" | "range" | "dropdown" | "color" | "text";
  default: unknown;
  description?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: { label: string; value: string }[];
}
interface PluginListItem {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  type: string;
  status: "ok" | "error";
  reason?: string;
  active: boolean;
  settingsSchema: PluginSettingDef[];
}

/** #rgb → #rrggbb（HTML color input 只认 7 字符值）；非法回落原值 */
function hex6(hex: string): string {
  const m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex.trim());
  return m ? `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}` : hex;
}

function ThemePluginsBlock() {
  const T = useT();
  const [plugins, setPlugins] = useState<PluginListItem[]>([]);
  const [valuesMap, setValuesMap] = useState<Record<string, Record<string, unknown>>>({});
  const [actErr, setActErr] = useState<{ id: string; reason: string } | null>(null);

  const reload = useRef(async () => {
    const api = window.pluginsAPI;
    if (!api) return;
    try {
      const list = (await api.list()) as PluginListItem[];
      setPlugins(Array.isArray(list) ? list : []);
      // 显示侧拉各插件 values（生效侧由宿主 assembleVars 读侧归一，§4.5 双侧纪律）
      const next: Record<string, Record<string, unknown>> = {};
      for (const p of Array.isArray(list) ? list : []) {
        if (!p || p.status !== "ok") continue;
        next[p.id] = (await settingsStore.get<Record<string, unknown>>("plugin." + p.id, "values", {})) || {};
      }
      setValuesMap(next);
    } catch {
      /* 无桥窗口 / 扫描失败：静默空列表 */
    }
  });

  useEffect(() => {
    void reload.current();
    const offPush = window.pluginsAPI?.onChanged?.(() => void reload.current());
    const offEvt = eventBus.on("settings/changed", (p) => {
      const scope = (p as { scope?: string } | null)?.scope || "";
      if (scope.startsWith("plugin.")) void reload.current();
    });
    return () => {
      offPush?.();
      offEvt();
    };
  }, []);

  if (!window.pluginsAPI) return null;

  async function setValues(pluginId: string, settingId: string, value: unknown) {
    const next = { ...(valuesMap[pluginId] || {}), [settingId]: value };
    setValuesMap({ ...valuesMap, [pluginId]: next });
    await settingsStore.set("plugin." + pluginId, "values", next);
    // settingsStore.set 内广播 settings/changed → 注入链重拉即时生效（无需在此另发事件）
  }

  async function activate(id: string) {
    setActErr(null);
    const r = await window.pluginsAPI?.setActive(id);
    if (r && !r.ok) setActErr({ id, reason: r.reason || T("激活失败") });
    await reload.current();
  }

  async function deactivate() {
    setActErr(null);
    await window.pluginsAPI?.setActive("");
    await reload.current();
  }

  const settingValue = (p: PluginListItem, s: PluginSettingDef): unknown => {
    const v = valuesMap[p.id]?.[s.id];
    return v === undefined ? s.default : v;
  };

  return (
    <>
      <h4>{T("主题插件")}</h4>
      <p className="form-hint">
        {T("主题插件来自应用数据目录的 plugins 文件夹（本期仅支持主题插件 type:theme，样式经宿主校验后注入）。与内置皮肤互斥——启用一方即停用另一方。")}
      </p>
      {plugins.length === 0 && <p className="form-hint">{T("尚未发现插件：把插件文件夹放入 plugins 目录后点「重新扫描」。")}</p>}
      <div className="plugin-list">
        {plugins.map((p) => (
          <div key={p.id} className="plugin-item" data-plugin-item={p.id}>
            <div className="plugin-item-main">
              <span className="plugin-item-name">{p.name}</span>
              {p.version && <span className="plugin-item-meta mono">v{p.version}</span>}
              {p.author && <span className="plugin-item-meta">{p.author}</span>}
              {p.status === "ok" ? (
                p.active ? (
                  <button type="button" className="plugin-text-btn" data-plugin-deactivate onClick={() => void deactivate()}>
                    {T("停用")}
                  </button>
                ) : (
                  <button type="button" className="plugin-text-btn" data-plugin-activate onClick={() => void activate(p.id)}>
                    {T("启用")}
                  </button>
                )
              ) : (
                <button type="button" className="plugin-text-btn" disabled title={p.reason}>
                  {T("启用")}
                </button>
              )}
              <span className="plugin-item-state">{p.active ? T("已激活") : p.status === "ok" ? T("未激活") : T("校验失败")}</span>
            </div>
            {p.status === "error" && <p className="plugin-item-reason">{p.reason}</p>}
            {p.status === "ok" && actErr?.id === p.id && <p className="plugin-item-reason">{actErr.reason}</p>}
            {p.status === "ok" && p.description && <p className="form-hint">{p.description}</p>}
            {p.status === "ok" && (p.settingsSchema?.length || 0) > 0 && (
              <div className="plugin-settings" data-plugin-settings={p.id}>
                {p.settingsSchema.map((s) => {
                  const v = settingValue(p, s);
                  return (
                    <div key={s.id} className="settings-row" data-plugin-setting={`${p.id}:${s.id}`}>
                      <span className="settings-row-label" title={s.description || s.name}>
                        {s.name}
                      </span>
                      {s.type === "toggle" && (
                        <input
                          type="checkbox"
                          checked={v === true}
                          onChange={(e) => void setValues(p.id, s.id, e.target.checked)}
                        />
                      )}
                      {s.type === "range" && (
                        <input
                          type="range"
                          min={s.min ?? 0}
                          max={s.max ?? 100}
                          step={s.step ?? 1}
                          value={Number(v) || 0}
                          onChange={(e) => void setValues(p.id, s.id, Number(e.target.value))}
                        />
                      )}
                      {s.type === "dropdown" && (
                        <select
                          value={String(v ?? "")}
                          onChange={(e) => void setValues(p.id, s.id, e.target.value)}
                        >
                          {(s.options || []).map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      )}
                      {s.type === "color" && (
                        <input
                          type="color"
                          value={hex6(String(v ?? "#000000"))}
                          onChange={(e) => void setValues(p.id, s.id, e.target.value)}
                        />
                      )}
                      {s.type === "text" && (
                        <input
                          type="text"
                          maxLength={100}
                          value={String(v ?? "")}
                          onChange={(e) => void setValues(p.id, s.id, e.target.value)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="settings-row">
        <button type="button" className="btn btn-outline btn-sm" data-plugin-open-folder onClick={() => void window.pluginsAPI?.openFolder()}>
          {T("打开插件文件夹")}
        </button>
        <button type="button" className="btn btn-outline btn-sm" data-plugin-rescan onClick={() => void reload.current()}>
          {T("重新扫描")}
        </button>
      </div>
    </>
  );
}

export default function SettingsPanel({
  theme,
  onThemeChange,
  skinId,
  onSkinChange,
  accentColor,
  onAccentChange,
  motionSetting,
  onMotionChange,
  onClose
}: Props) {
  const T = useT();
  const [activeNav, setActiveNav] = useState("appearance");
  const layoutRef = useRef<HTMLDivElement>(null);
  // D120 §8.1：出场两步走——Esc / 遮罩点击 / 关闭按钮收口到同一 requestClose；
  // data-show 只挂在 modal 容器级（backdrop/panel），13 个 sec-* 区块仍常挂载，内部结构不动
  const { show, requestClose } = useDismiss(onClose);
  const panelRef = useDialogA11y<HTMLDivElement>(requestClose);

  // 滚动时同步左导航高亮（v45 引入的收敛修正全部继承：scroll + scrollend + 220ms 尾随测一次）。
  // v48.70（D114）：13 个导航项与 13 个区块一一对应（SECTION_GROUPS 生成 navIds），
  // 不再需要「跳过无导航节」的特判；子块 id（sec-learningday/sec-siblingbury/sec-global）
  // 挂在 div 上、不带 .settings-section 类，天然不进测量集。
  useEffect(() => {
    const root = layoutRef.current;
    if (!root) return;
    const navIds = new Set(SECTION_GROUPS.flatMap((g) => g.items.map((s) => `sec-${s.id}`)));
    // 每次现取：仪表盘等区块在数据加载后才从骨架换成真内容，挂载时快照会漏节
    const listItems = () =>
      Array.from(root.querySelectorAll<HTMLElement>(".settings-section[id]")).filter((el) => navIds.has(el.id));
    // 宽档由 .settings-content 滚动（左导航固定不动），窄档由 .settings-layout 整体滚动
    const contentEl = root.querySelector<HTMLElement>(".settings-content");
    const scroller = () =>
      contentEl && getComputedStyle(contentEl).overflowY === "auto" ? contentEl : root;
    const measure = () => {
      const items = listItems();
      if (!items.length) return;
      const sc = scroller();
      // 已滚到底：最后一节再怎么滚也到不了顶部，最近判据会停在倒数第二节 → 兜底
      if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 8) {
        setActiveNav(items[items.length - 1].id.replace(/^sec-/, ""));
        return;
      }
      const rt = sc.getBoundingClientRect().top;
      // 判据取「距容器顶最近的一节」而不是「最后一条越过判定线的节」：
      // 平滑滚动落点前约 40px 就不再触发 scroll，越线判据会稳定地慢一节。
      let best = items[0];
      let bestD = Infinity;
      for (const el of items) {
        const d = Math.abs(el.getBoundingClientRect().top - rt);
        if (d < bestD) { bestD = d; best = el; }
      }
      setActiveNav(best.id.replace(/^sec-/, ""));
    };
    // 平滑滚动的最后一帧不保证送达 scroll 事件（实测停在落点前约 40px），
    // 故每次滚动事件后再尾随测一次，保证最终收敛到落点。
    let tail = 0;
    const onScroll = () => {
      measure();
      window.clearTimeout(tail);
      tail = window.setTimeout(measure, 220);
    };
    const targets = [root, contentEl].filter((x): x is HTMLElement => !!x);
    for (const t of targets) {
      t.addEventListener("scroll", onScroll, { passive: true });
      t.addEventListener("scrollend", onScroll);
    }
    measure();
    return () => {
      window.clearTimeout(tail);
      for (const t of targets) {
        t.removeEventListener("scroll", onScroll);
        t.removeEventListener("scrollend", onScroll);
      }
    };
    // SECTION_GROUPS 是模块级常量，挂载一次即可
  }, []);

  // 点击导航 → 平滑滚动 + 目标 h3 聚焦（tabindex=-1，屏幕阅读器可达，设计稿 §6.3）；
  // prefers-reduced-motion 下改 auto（§11 降级纪律）。
  const jumpTo = (id: string) => {
    setActiveNav(id);
    const el = document.getElementById(`sec-${id}`);
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth" });
    el.querySelector("h3")?.focus({ preventScroll: true });
  };

  return (
    <div className="modal-backdrop" data-show={show ? "in" : "out"} onClick={requestClose}>
      <div
        className="modal-panel modal-panel-wide settings-panel"
        data-ui="dialog"
        data-show={show ? "in" : "out"}
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={T("设置")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>{T("设置")}</h2>
          <button className="icon-btn modal-close" title={T("关闭")} aria-label={T("关闭设置")} onClick={requestClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <div className="settings-layout modal-scroll" ref={layoutRef}>
          <nav className="settings-nav" data-ui="sidebar" aria-label={T("设置分区")}>
            {SECTION_GROUPS.map((g) => (
              <Fragment key={g.label}>
                {/* 组标题：非交互 div，不进 Tab 序、不进 .settings-nav button 查询集（§5.4） */}
                <div className="settings-nav-group">{T(g.label)}</div>
                {g.items.map((s) => (
                  <button
                    key={s.id}
                    className={activeNav === s.id ? "active" : ""}
                    aria-current={activeNav === s.id ? "true" : undefined}
                    onClick={() => jumpTo(s.id)}
                  >
                    {T(s.label)}
                  </button>
                ))}
              </Fragment>
            ))}
          </nav>

          <div className="settings-content">
            <SettingsSection id="sec-appearance" title={T("主题与颜色")}>
              <h4>{T("主题模式")}</h4>
              <div className="seg-tabs" data-ui="seg-tabs">
                <button className={theme === "light" ? "active" : ""} onClick={() => onThemeChange("light")}>
                  {T("浅色")}
                </button>
                <button className={theme === "dark" ? "active" : ""} onClick={() => onThemeChange("dark")}>
                  {T("深色")}
                </button>
              </div>
              <h4>{T("皮肤")}</h4>
              {/* v49.0 / P7：皮肤卡片——名称 + 一行描述 + 明/暗预览色块 + 动效标签；
                  requiresChrome 不满足时置灰并提示（Electron 31 / Chromium 126 当前恒满足） */}
              <div className="skin-list skin-cards">
                {SKINS.map((s) => {
                  const m = s.manifest;
                  const chromeShort = typeof navigator !== "undefined" && m.requiresChrome
                    ? (() => {
                        const v = /Chrom(?:e|ium)\/(\d+)/.exec(navigator.userAgent)?.[1];
                        return v ? Number(v) < m.requiresChrome : false;
                      })()
                    : false;
                  const motionLabel = { none: T("无动效"), subtle: T("动效：轻"), rich: T("动效：丰富") }[m.features?.motion ?? "subtle"];
                  return (
                    <button
                      key={m.id}
                      className={`skin-card${skinId === m.id ? " active" : ""}${chromeShort ? " disabled" : ""}`}
                      disabled={chromeShort}
                      title={chromeShort ? T("需要 Chromium ≥ {n}", { n: m.requiresChrome }) : m.description ? T(m.description) : undefined}
                      onClick={() => onSkinChange(m.id)}
                    >
                      <span className="skin-card-preview" aria-hidden="true">
                        {m.preview.light.slice(0, 4).map((c, i) => (
                          <i key={i} style={{ background: c }} />
                        ))}
                      </span>
                      <span className="skin-card-name">{T(m.name)}</span>
                      {m.description && <span className="skin-card-desc">{T(m.description)}</span>}
                      <span className="skin-card-meta">{motionLabel}</span>
                    </button>
                  );
                })}
              </div>
              {/* v48.89（D132 §8.1）：主题插件子块——落位 sec-appearance 内「皮肤」与「强调色」之间，
                  不新增 SECTION_GROUPS 导航项（D114 的 5 组契约零改动）、不新增 sec-* 锚 */}
              <ThemePluginsBlock />
              {/* v49.0 / D172：强调色按皮肤记忆——显示值 = 当前皮肤用户值 || 皮肤默认 accent；
                  accentPolicy=locked 的皮肤隐藏本行（「恢复默认」只清当前皮肤的用户值） */}
              {SKINS.find((s) => s.manifest.id === skinId)?.manifest.accentPolicy !== "locked" && (
                <>
                  <h4>{T("强调色")}</h4>
                  <div className="settings-row accent-row">
                    <input
                      type="color"
                      value={accentColor || SKINS.find((s) => s.manifest.id === skinId)?.manifest.defaultAccent?.[theme] || "#166a59"}
                      onChange={(e) => onAccentChange(e.target.value)}
                    />
                    <button className="btn btn-secondary btn-sm" onClick={() => onAccentChange("")}>{T("恢复默认")}</button>
                  </div>
                </>
              )}
              {/* v49.0 / D170（P2-6）：应用内动效等级——关闭动画 = body.motion-off 总开关（压过皮肤动效） */}
              <h4>{T("动画")}</h4>
              <div className="seg-tabs">
                <button className={motionSetting === "system" ? "active" : ""} onClick={() => onMotionChange("system")}>
                  {T("跟随系统")}
                </button>
                <button className={motionSetting === "off" ? "active" : ""} onClick={() => onMotionChange("off")}>
                  {T("关闭动画")}
                </button>
              </div>
            </SettingsSection>

            {/* v49.8（D182）：界面语言（sec-language，唯一切换入口）——与左栏导航一致，「界面」组内紧跟主题与颜色 */}
            <LanguageSection />

            <ReaderSection />

            {/* 复习与调度（D114 §5.2）：摘录复习 → 每日上限 → 调度规则 → 卡面与标签 → FSRS */}
            <ExtractReviewSection />
            <LimitsSection />
            <ScheduleSection />
            <CardTagsSection />
            <FSRSSection />

            {/* 智能 */}
            <AISection />
            <DictSection />
            {/* v48.114（D159）：<MemorySection />（sec-memory）随用户记忆功能暂时移除，代码保留待重实装 */}

            {/* 数据与效率 */}
            <BackupSection />
            <LogsSection />
            <UpdateSection />
            <ShortcutsSection />
            <DashboardSection />
            {/* v48.81（D125，用户指令）：实验功能——学习者知识模型设置迁入（sec-learner 子块 id 保留），
                与既有实验项同带「早期开发阶段」标识；左栏按钮 14 → 15 */}
            <SettingsSection id="sec-lab" title={T("实验功能")}>
              <p className="form-hint">{T("实验功能 · 早期开发阶段。")}</p>
              <div id="sec-learner">
                <LearnerBlock />
              </div>
            </SettingsSection>

            {/* v49.7（D181）：关于——纯信息节（应用信息 + 开源许可），左栏按钮 15 → 16 */}
            <AboutSection />
          </div>
        </div>
      </div>
    </div>
  );
}
