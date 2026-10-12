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
import { memoryApi, type MemoryPendingStats, type MemoryStatus } from "../lib/memory";
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

export type ThemeMode = "light" | "dark";

interface Props {
  theme: ThemeMode;
  onThemeChange: (m: ThemeMode) => void;
  skinId: string;
  onSkinChange: (id: string) => void;
  accentColor: string;
  onAccentChange: (color: string) => void;
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

// ---------- 新信息架构（v48.70 / D114，设计稿 §5）----------
// 14 项平铺导航收编为 5 组 13 项；组标题为非交互 div，不进 .settings-nav button 查询集；
// 13 个导航项与 13 个 card-fill 区块一一对应（区块常挂载、无条件卸载，滚动定位一一可达）。
// v48.81（D125，用户指令）：新增「实验功能」（sec-lab，归「数据与效率」组末位），学习者知识模型
// 设置自 sec-widgets 迁入——左栏按钮 14 → 15（D114 立约文本记 13 项，DOM 实际计数 14，历史出入以实际为准）；
// 可达性沿用 92vh + 导航自滚兜底（D116）。
const SECTION_GROUPS: Array<{ label: string; items: Array<{ id: string; label: string }> }> = [
  { label: "界面", items: [{ id: "appearance", label: "主题与颜色" }] },
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
      { id: "dict", label: "词典与查词" },
      { id: "memory", label: "用户记忆" }
    ]
  },
  {
    label: "数据与效率",
    items: [
      { id: "backup", label: "备份与恢复" },
      { id: "logs", label: "日志" },
      { id: "shortcuts", label: "快捷键" },
      { id: "widgets", label: "统计仪表盘" },
      { id: "lab", label: "实验功能" }
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
    <SettingsSection id="sec-widgets" title="统计仪表盘">
      {!loaded ? (
        <SkeletonBlock h={120} />
      ) : (
        <>
          <h4>
            统计组件
            <SettingsInfo label="统计组件">
              宽幅＝通栏一行；窄幅＝半幅，相邻窄幅自动两两成行。拖动组件标题栏可交换位置。
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
                <div className="seg-tabs seg-tabs-sm" role="group" aria-label={`${w.title}宽度`}>
                  <button
                    className={(sizes[w.id] ?? "wide") === "wide" ? "active" : ""}
                    onClick={() => setWidgetSize(w.id, "wide")}
                  >
                    宽幅
                  </button>
                  <button
                    className={sizes[w.id] === "half" ? "active" : ""}
                    onClick={() => setWidgetSize(w.id, "half")}
                  >
                    窄幅
                  </button>
                </div>
              </div>
            ))}
          </div>
          {/* sec-dashreset 撤销（D114）：「恢复默认排列与宽度」收编为本节一行 */}
          <div className="settings-row">
            <button className="btn btn-secondary btn-sm" onClick={resetLayout}>恢复默认排列与宽度</button>
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
          ? { ok: true, text: "已切换服务，并自动恢复了该服务之前保存的 API Key。" }
          : { ok: true, text: "已切换服务。请粘贴该服务的 API Key 并保存。" }
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
      const saved = await withTimeout(doSave(), 15000, "保存配置");
      // aiConfigUsable：本地预设免 Key（v48.68 / D112，与主进程 needKey 纪律对齐）
      if (!saved || !aiConfigUsable(saved)) {
        setNotice({ ok: false, text: "请先粘贴 API Key，点击「保存配置」后再测试" });
        return;
      }
      const result = await withTimeout(aiGateway.test(), 90000, "测试连接");
      setNotice({ ok: result.ok, text: result.ok ? "连接正常，AI 制卡 / 解释可用" : result.message });
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
      await withTimeout(doSave(), 15000, "保存配置");
      const list = await withTimeout(aiGateway.listModels(), 30000, "拉取模型列表");
      setModels(list);
      setModelFilter("");
      setModelsOpen(list.length > 0);
      setNotice({
        ok: true,
        text: list.length > 0 ? `已拉取 ${list.length} 个模型 — 点击「模型名」框从列表选择` : "服务未返回模型列表，请手输"
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
      const r = await withTimeout(aiGateway.detectLocal(), 20000, "检测本地服务");
      if (!r) {
        setNotice({ ok: false, text: "当前应用不支持本地探测，请重启应用后再试" });
        return;
      }
      setLocalDetect(r);
      if (r.detected) {
        if (r.baseUrl && cfg && r.baseUrl !== cfg.baseUrl) await save({ baseUrl: r.baseUrl });
        setModels(r.models || []);
        setModelFilter("");
        setNotice({
          ok: true,
          text: `检测到 ${r.runtimeName || "本地服务"}（${r.baseUrl}）· ${(r.models || []).length} 个模型已填入「模型名」下拉`
        });
      } else {
        setNotice({ ok: false, text: r.message || "未检测到本地模型服务" });
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
    <SettingsSection id="sec-ai" title="AI 服务">
      {GROUP_ORDER.map((g) => {
        const items = presets.filter((p) => (p.group || "official") === g);
        if (items.length === 0) return null;
        return (
          <div key={g} className="ai-preset-group">
            <p className="ai-preset-group-label">{GROUP_LABELS[g] || g}</p>
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
          在{" "}
          <a href={presetMeta.keyUrl} target="_blank" rel="noreferrer">
            {presetMeta.name}
          </a>{" "}
          创建 Key。{presetMeta.hint}
        </p>
      )}

      {cfg.preset === "local" && (
        <div className="settings-row settings-row-wrap">
          <button className="btn btn-outline btn-sm" disabled={busy !== ""} onClick={handleDetectLocal}>
            {busy === "detect" ? "检测中…" : "检测本地服务"}
          </button>
          {localDetect && (
            <span className={localDetect.detected ? "ai-test-ok" : "ai-test-fail"}>
              {localDetect.detected
                ? `已检测到 ${localDetect.runtimeName || "本地服务"}`
                : (localDetect.message || "未检测到本地模型服务")}
            </span>
          )}
        </div>
      )}

      <div className="ai-fields">
        {cfg.preset === "custom" && (
          <div className="form-field">
            <label>Base URL（OpenAI 兼容，含 /v1）</label>
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
              服务地址（Ollama 默认 11434，LM Studio 默认 1234）
              <SettingsInfo label="服务地址">本机服务无需 API Key；端口 Ollama 11434 / LM Studio 1234。</SettingsInfo>
            </label>
            <input
              className="mono"
              value={cfg.baseUrl}
              placeholder="http://localhost:11434/v1"
              onChange={(e) => setCfg({ ...cfg, baseUrl: e.target.value })}
            />
            {!/\/v\d+$/.test(cfg.baseUrl.trim()) && (
              <p className="ai-test-fail">
                地址缺少 /v1 后缀 —— OpenAI 兼容端点通常需要它（如 http://127.0.0.1:1234/v1）
              </p>
            )}
          </div>
        )}

        <div className="form-field" ref={modelsRef}>
          <label>模型名</label>
          <div className="model-select">
            <input
              className="mono"
              value={modelInput}
              placeholder={presetMeta?.model || "模型名（可手输）"}
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
                    列表无匹配 — 将直接使用手输的模型名
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/glm-5\.[2-9]/i.test(cfg.model) && (
          <div className="form-field">
            <label>思考强度（低更快；仅 GLM-5.2+ 生效）</label>
            <div className="seg-tabs">
              {[
                { id: "low", label: "低" },
                { id: "high", label: "中" },
                { id: "max", label: "强" }
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
            <label>API Key {cfg.hasKey ? "（已保存）" : "（尚未保存 — 填好后点「保存配置」）"}</label>
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
          {busy === "save" ? "保存中…" : "保存配置"}
        </button>
        <button className="btn btn-secondary btn-sm" disabled={busy !== ""} onClick={handleTest}>
          {busy === "test" ? "测试中…" : "测试连接"}
        </button>
        <button className="btn btn-outline btn-sm" disabled={busy !== ""} onClick={handleFetchModels}>
          {busy === "models" ? "拉取中…" : "拉取模型列表"}
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
  return (
    <SettingsSection id="sec-schedule" title="调度规则">
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
  const [cutoff, setCutoff] = useState<number | null>(null);
  const [savedTick, setSavedTick] = useState(0);
  useEffect(() => {
    settingsStore.get<number>("app", "dayCutoffHour", 0).then((v) => setCutoff(Number(v) || 0));
  }, []);
  const options = Array.from({ length: 24 }, (_, h) => ({
    value: String(h),
    label: h === 0 ? "午夜 0 点（默认）" : `凌晨/上午 ${h} 点`
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
      <h4>学习日</h4>
      <div className="settings-row">
        <span className="settings-row-label">
          新一天从
          <SettingsInfo label="新一天从">凌晨的学习计入前一天。仅影响统计与热力图，不影响 FSRS 复习间隔。</SettingsInfo>
        </span>
        {cutoff !== null && (
          <Dropdown value={String(cutoff)} options={options} align="left" onChange={update} title="学习日切点" />
        )}
      </div>
      {savedTick % 2 === 1 && <p className="ai-test-ok settings-saved">已保存，统计口径即时生效。</p>}
    </>
  );
}

// 同源卡延后（v34，M12/D33/§4.16）：同一制卡来源单元的多张卡同一学习日只放行一张、其余延至次日。
// 延后是队列视图而非调度写入——不改 FSRS 的 due/S/D，不产生复习日志，次日自动解封。
function SiblingBuryBlock() {
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
        同源卡延后
        <SettingsInfo label="同源卡延后">同源组同日只放行一张，防互相泄题；不改调度，次日自动解封，仍可在卡片浏览页主动复习。</SettingsInfo>
      </h4>
      {cfg && (
        <>
          <div className="settings-row">
            <span>同源卡延后</span>
            <div className="seg-tabs seg-tabs-sm" role="group" aria-label="同源卡延后开关">
              <button className={cfg.enabled ? "active" : ""} onClick={() => update({ enabled: true })}>开</button>
              <button className={!cfg.enabled ? "active" : ""} onClick={() => update({ enabled: false })}>关</button>
            </div>
          </div>
          <div className="settings-row">
            <span>新卡同源延后（Bury new siblings）</span>
            <input type="checkbox" checked={cfg.newCards} onChange={(e) => update({ newCards: e.target.checked })} />
          </div>
          <div className="settings-row">
            <span>复习卡同源延后（Bury review siblings）</span>
            <input type="checkbox" checked={cfg.reviewCards} onChange={(e) => update({ reviewCards: e.target.checked })} />
          </div>
          <div className="settings-row">
            <span>同源组每日放行</span>
            <input
              className="mono input-num"
              type="number"
              min={1}
              max={20}
              value={cfg.perDay}
              onChange={(e) => update({ perDay: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })}
            />
            <span>张</span>
          </div>
          <div className="settings-row settings-row-wrap">
            <span className="settings-row-label">
              短材料阈值
              <SettingsInfo label="短材料阈值">该字符数以内才按「同一次选区」建组（长选区各卡锚定不同知识点，不延后）。</SettingsInfo>
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
      {savedTick % 2 === 1 && <p className="ai-test-ok settings-saved">已保存，队列即时生效。</p>}
    </>
  );
}

// ---------- 卡面与标签（v48.70 / D114）：卡面信息密度 + 标签功能总开关物理合并 ----------
// data-cf-* / tags-enabled-toggle / data-tags-on/off 钩原样保留（d104/d107 为 document 级查询，位置无关）。
function CardTagsSection() {
  return (
    <SettingsSection id="sec-cardtags" title="卡面与标签">
      <WorkbenchBlock />
      <CardFaceBlock />
      <TagsBlock />
    </SettingsSection>
  );
}

// 制卡台放置位置（v48.79，D123）：右侧（默认）/ 底部。与使用习惯相关、很少调整，所以放设置而不放在面板上。
function WorkbenchBlock() {
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
        制卡台
        <SettingsInfo label="制卡台">
          手动制卡、AI 制卡、AI 解释都在制卡台里；顶栏「制卡台」按钮或 Ctrl+K 开合。最大化时向内推，非最大化时窗口会向右变宽（屏幕放不下则向内推）。
        </SettingsInfo>
      </h4>
      <div className="settings-row">
        <span className="settings-row-label">放置位置</span>
        <div className="seg-tabs" role="radiogroup" aria-label="制卡台放置位置">
          {(["right", "bottom"] as const).map((m) => (
            <button key={m} role="radio" aria-checked={placement === m} data-wb-placement={m} className={placement === m ? "active" : ""} onClick={() => void change(m)}>
              {m === "right" ? "右侧" : "底部"}
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
        卡面信息密度
        <SettingsInfo label="卡面信息密度">关闭即不渲染对应块；不改卡内数据，也不影响制卡时的质检。</SettingsInfo>
      </h4>
      {cfg && (
        <>
          <div className="settings-row">
            <span>显示助记</span>
            <input type="checkbox" data-cf-mnemonic checked={cfg.mnemonic} onChange={(e) => update({ mnemonic: e.target.checked })} />
          </div>
          <div className="settings-row">
            <span>显示例子</span>
            <input type="checkbox" data-cf-example checked={cfg.example} onChange={(e) => update({ example: e.target.checked })} />
          </div>
          <div className="settings-row">
            <span>显示来源</span>
            <input type="checkbox" data-cf-source checked={cfg.sourceRef} onChange={(e) => update({ sourceRef: e.target.checked })} />
          </div>
        </>
      )}
      {savedTick % 2 === 1 && <p className="ai-test-ok settings-saved">已保存，卡面即时生效。</p>}
    </>
  );
}

// ---------- 标签功能总开关（v48.63，D107）：一键开启/关闭全部标签入口与展示 ----------
// 覆盖：手动制卡标签行、AI 制卡的批注标签继承（批 F 的 AI 建议标签届时同受此开关）、
// 复习页标签区与快捷打标、浏览器批量打标/去标、卡详情标签区、筛选牌组构建器标签条件。
// 只隐藏入口与展示——已存标签数据零改动，重新打开即恢复；查询 tag: 与已存 scope 照常生效。
function TagsBlock() {
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
      <h4>标签功能</h4>
      {enabled !== null && (
        <div className="settings-row">
          <span className="settings-row-label">
            启用标签功能
            <SettingsInfo label="启用标签功能">关闭隐藏全部标签入口与展示（AI 标签建议同停）；已存标签数据原样保留，重开即恢复。</SettingsInfo>
          </span>
          <div className="seg-tabs seg-tabs-sm" role="group" aria-label="标签功能开关" data-testid="tags-enabled-toggle">
            <button className={enabled ? "active" : ""} data-tags-on onClick={() => update(true)}>开</button>
            <button className={!enabled ? "active" : ""} data-tags-off onClick={() => update(false)}>关</button>
          </div>
        </div>
      )}
      {savedTick % 2 === 1 && <p className="ai-test-ok settings-saved">已保存，各界面即时生效。</p>}
    </>
  );
}

// ---------- 摘录复习（v48.22，D58/§6.8）：并入复习队列 / 混编模式 / 推送引擎 ----------
// 实验项必须带「实验功能 · 早期开发阶段」标识与说明（用户口径）；切换推送引擎为**无损**操作
// （每引擎私有子空间互不覆盖，A→B→A 往返逐字段等值，指南 §6.8-4）。
function ExtractReviewSection() {
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
      if (!r.ok) setRerankNote(`未能重排：${r.reason || "未知原因"}`);
      else if (r.usedAI) setRerankNote(`已按 AI 重排 ${r.count} 条（之后的摘录写操作会自动刷新）`);
      else setRerankNote(`未采用 AI 结果：${r.reason || "输出未通过本地裁决"}——当前用本地因子序`);
    } catch (e) {
      setRerankNote(`重排失败：${e instanceof Error ? e.message : String(e)}`);
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
    <SettingsSection id="sec-extracts" title="摘录复习">
      {cfg && (
        <>
          <div className="settings-row">
            <span className="settings-row-label">
              并入复习队列（传统 SuperMemo 方式）
              <SettingsInfo label="并入复习队列">开启后复习时按混编规则推送摘录卡，可就地处理；关闭时摘录在顶栏「摘录」页连续处理。</SettingsInfo>
            </span>
            <div className="seg-tabs seg-tabs-sm" role="group" aria-label="摘录并入复习队列">
              <button className={cfg.mergeIntoReview ? "active" : ""} onClick={() => void update({ mergeIntoReview: true })}>开</button>
              <button className={!cfg.mergeIntoReview ? "active" : ""} onClick={() => void update({ mergeIntoReview: false })}>关</button>
            </div>
          </div>
          <div className="settings-row">
            <span className="settings-row-label">
              混编规则
              <SettingsInfo label="混编规则">切换不写任何调度状态：未放行的摘录仍在库内到期，切换后立即可见。</SettingsInfo>
            </span>
            <Dropdown
              value={cfg.interleave}
              align="left"
              options={[
                { value: "quota-1-4", label: "上限 1:4（每 4 张卡至多 1 条摘录，SuperMemo 口径）" },
                { value: "by-due", label: "按到期时间自然混排" }
              ]}
              onChange={(v) => void update({ interleave: v as InterleaveMode })}
            />
          </div>
          <div className="settings-row">
            <span className="settings-row-label">
              摘录推送引擎
              <SettingsInfo label="摘录推送引擎">
                实验引擎按本地因子（优先级/逾期/搁置/同书连击）排序并给逐条可验证理由；AI 重排只影响处理顺序、
                经本地裁决过滤；{frontierNote}。切回 SuperMemo 无损。
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
              <p className="form-hint">实验功能 · 早期开发阶段。</p>
              <div className="settings-row">
                <span>AI 重排</span>
                <button className="btn btn-outline btn-sm" data-rerank-now disabled={busyRerank} onClick={() => void runRerank()}>
                  立即重排（对当前到期批）
                </button>
              </div>
              {rerankNote && <p className="form-hint">{rerankNote}</p>}
            </>
          )}
        </>
      )}
      {savedTick % 2 === 1 && <p className="ai-test-ok settings-saved">已保存，队列即时生效。</p>}
    </SettingsSection>
  );
}

// ---------- 每日上限（v48.22，D58/§6.8-5）：四类上限 + 三层限幅 ----------
// 硬边界（复习上限 ≥ 新上限 × 5）由**主进程 settings:set 兜底拒写**，此处只做即时提示；
// 用量为派生值（review_logs / extract_ops），重启不漂移。
function LimitsSection() {
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
      title="每日上限"
      info={
        <SettingsInfo label="每日上限">
          四类上限按学习日（「新一天从」时刻）计算，全部范围共享同一份额度；填 0 表示不限制。
        </SettingsInfo>
      }
    >
      {limits && (
        <>
          {num("每日新卡片上限", "newCardsPerDay", "首次作答的卡片张数")}
          {num(
            "每日卡片复习上限",
            "cardReviewsPerDay",
            "卡片作答总次数（新卡与复习卡共用）",
            <SettingsInfo label="每日卡片复习上限">
              硬边界：不得低于新卡上限的 5 倍；低于 10 倍时给出提示（Anki 经验：20 张新卡约 200 次复习/日）。
            </SettingsInfo>
          )}
          {num("每日新摘录上限", "newExtractsPerDay", "新引入的摘录条数")}
          {num("每日摘录处理上限", "extractReviewsPerDay", "到期摘录的处理条数")}
          <div className="settings-row">
            <span className="settings-row-label">
              复习上限用尽后仍发新卡与新摘录
              <SettingsInfo label="复习上限用尽后仍发新卡与新摘录">关闭（默认）＝防积压的结构闸：复习额度用尽即停发新卡与新摘录。</SettingsInfo>
            </span>
            <input
              type="checkbox"
              checked={limits.ignoreReviewLimitForNew}
              onChange={(e) => void save({ ignoreReviewLimitForNew: e.target.checked })}
            />
          </div>
          {state && (
            <p className="form-hint">
              今日已用：新卡 {state.usage.newCards}/{state.limits.newCardsPerDay || "∞"} · 复习 {state.usage.cardReviews}/
              {state.limits.cardReviewsPerDay || "∞"} · 新摘录 {state.usage.newExtracts}/{state.limits.newExtractsPerDay || "∞"} ·
              摘录处理 {state.usage.extractReviews}/{state.limits.extractReviewsPerDay || "∞"}
              {state.newBlocked ? "（复习额度已用尽，新卡与新摘录已停发）" : ""}
            </p>
          )}
        </>
      )}
      {errors.length > 0 && <p className="ai-test-err">{errors.join("；")}</p>}
      {errors.length === 0 && advisory.length > 0 && <p className="form-hint">提示：{advisory.join("；")}</p>}
      {savedTick % 2 === 1 && <p className="ai-test-ok settings-saved">已保存，队列即时生效。</p>}
    </SettingsSection>
  );
}

// ---------- 用户记忆（v45，M14-UM1，D39 / §6.7）：唯一入口 sec-memory ----------
// AI 自主维护（§1.7 有界例外）→ 产品面只做「可见、可控、可停止」：不提供编辑界面（外部编辑器打开），
// 总开关默认关；首次开启一次性说明 → 补处理预估确认 → 进度可中止（水位线推进，中止不丢进度）。
function MemorySection() {
  const [status, setStatus] = useState<MemoryStatus | null>(null);
  const [introOpen, setIntroOpen] = useState(false);
  const [preview, setPreview] = useState<MemoryPendingStats | null>(null);
  const [resetArmed, setResetArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  // v46（M14-UM2，§6.7.1）：注入预算可调（字；core/目录/主题按 800/1200/2400 配比缩放）
  const [injectBudget, setInjectBudget] = useState<number | null>(null);

  useEffect(() => {
    settingsStore
      .get<Record<string, unknown> | null>("app", "memory", null)
      .then((m) => setInjectBudget(Number((m as { injectBudget?: number })?.injectBudget) || 4400));
  }, []);

  async function changeInjectBudget(n: number) {
    const v = Math.max(200, Math.min(20000, Number(n) || 4400));
    setInjectBudget(v);
    const cur = await settingsStore.get<Record<string, unknown> | null>("app", "memory", null);
    await settingsStore.set("app", "memory", { ...(cur || {}), injectBudget: v });
  }

  async function refresh() {
    const st = await memoryApi.status();
    setStatus(st);
    return st;
  }
  useEffect(() => {
    void refresh();
    return eventBus.on("memory/changed", () => void refresh());
  }, []);

  async function toggle(on: boolean) {
    setNotice(null);
    if (on) {
      const st = await refresh();
      if (st && !st.introAcked) {
        setIntroOpen(true);
      } else {
        await memoryApi.setEnabled({ enabled: true, introAcked: true });
        await refresh();
      }
    } else {
      await memoryApi.setEnabled({ enabled: false });
      setPreview(null);
      await refresh();
    }
  }

  // 首次开启说明 → 确认：生效 + 拉补处理预估（§6.7.2：范围与预估先行，用户确认或取消）
  async function confirmIntro() {
    setBusy(true);
    try {
      await memoryApi.setEnabled({ enabled: true, introAcked: true });
      const pv = await memoryApi.backfillPreview();
      setPreview(pv && pv.entryCount > 0 ? pv : null);
      setIntroOpen(false);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function startBackfill() {
    setBusy(true);
    try {
      await memoryApi.backfillStart();
      setPreview(null);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function tidyNow() {
    setBusy(true);
    setNotice(null);
    try {
      const r = await memoryApi.tidyNow();
      if (!r) setNotice({ ok: false, text: "记忆接口不可用（需重启应用）" });
      else if (r.skipped) setNotice({ ok: false, text: `未执行：${r.skipped}` });
      else if (!r.ok) setNotice({ ok: false, text: `整理失败：${r.error || "未知错误"}` });
      else setNotice({ ok: true, text: `整理完成（应用 ${r.ops ?? 0} 条操作）。` });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function doReset() {
    setBusy(true);
    try {
      await memoryApi.reset();
      setResetArmed(false);
      setNotice({ ok: true, text: "记忆已清空并重建脚手架（日记与卡片不受影响）。" });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const bf = status?.backfill;
  return (
    <SettingsSection id="sec-memory" title="用户记忆（AI 自动维护）">
      <p className="form-hint">
        软件把你的日记自动整理成一份本地记忆文件，将来制卡时为「应用类卡片」提供你真实经历过的情境。
        会发送什么：日记新增/改动片段；何时发送：日记变更防抖后与启动补跑；发到哪里：你自己配置的 AI 模型；
        不会做什么：不上传遥测、不写卡片正文、不参与复习调度。文件纯本地保存，可随时用编辑器查看修改，可随时关闭。
      </p>
      {status && (
        <>
          <div className="settings-row">
            <span>用户记忆</span>
            <div className="seg-tabs seg-tabs-sm" role="group" aria-label="用户记忆开关">
              <button className={status.enabled ? "active" : ""} onClick={() => toggle(true)}>开</button>
              <button className={!status.enabled ? "active" : ""} onClick={() => toggle(false)}>关</button>
            </div>
          </div>
          <div className="settings-row">
            <span>文件位置</span>
            <span className="mono fs-meta">{status.memoryDir}</span>
            <button className="btn-outline btn-sm" onClick={() => void memoryApi.openFolder()}>打开文件夹</button>
            <button className="btn-outline btn-sm" onClick={() => void memoryApi.openFile("core.md")}>打开 core.md</button>
          </div>
          <div className="settings-row">
            <span>立即整理</span>
            <button className="btn btn-secondary btn-sm" disabled={busy || !status.enabled || status.pending.entryCount === 0} onClick={() => void tidyNow()}>
              立即整理（待处理 {status.pending.entryCount} 条）
            </button>
            {!status.enabled && <span className="form-hint">开关关闭期间不整理</span>}
            {status.enabled && status.pending.entryCount === 0 && <span className="form-hint">没有未整理的日记条目</span>}
          </div>
          <div className="settings-row">
            <span>记忆用量</span>
            <span className="mono fs-meta">
              core {status.usage.core.chars} 字 / 目录 {status.usage.index.chars} 字 / 主题文件 {status.usage.topics.length} 个 · 合计 ≈ {status.usage.totals.tokens} token
            </span>
          </div>
          <div className="settings-row">
            <span className="settings-row-label">
              注入预算
              <SettingsInfo label="注入预算">制卡时单次注入记忆的字数上限；core/目录/主题按比例分配。</SettingsInfo>
            </span>
            <input
              className="mono input-num input-num-md"
              type="number"
              min={200}
              max={20000}
              step={200}
              value={injectBudget ?? 4400}
              onChange={(e) => void changeInjectBudget(Number(e.target.value))}
            />
          </div>
          {bf?.running && (
            <div className="settings-row">
              <span>补处理：已整理 {bf.done}/{bf.total || "?"} 条</span>
              <button className="btn btn-secondary btn-sm" onClick={() => void memoryApi.backfillCancel()}>中止</button>
            </div>
          )}
          <div className="settings-row">
            <span>重置记忆</span>
            {!resetArmed ? (
              <button className="btn btn-danger-outline btn-sm" onClick={() => setResetArmed(true)}>清空记忆文件…</button>
            ) : (
              <>
                {/* 不可逆删除：瑞士风要求破坏性操作用 error 填充，而不是把全屏唯一
                    的高饱和焦点色（accent）用在最危险的动作上；确认面板出现时焦点落「取消」（D50 先例，D114 §10） */}
                <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => void doReset()}>确认清空</button>
                <button className="btn btn-secondary btn-sm" onClick={() => setResetArmed(false)} autoFocus>取消</button>
              </>
            )}
          </div>
          {resetArmed && (
            <p className="form-hint">将删除 memory/ 下全部记忆文件并重建空脚手架。只删除记忆，不影响日记与卡片；开关状态保留。</p>
          )}
          {preview && (
            <div className="restore-confirm">
              <p className="restore-confirm-title">补处理预估</p>
              <p className="form-hint">
                待整理日记 {preview.entryCount} 条{preview.truncated ? "（至多统计 1000 条）" : ""}，预计 {preview.batchCount} 批 / {preview.estCalls} 次 AI 调用，
                约 {preview.estTokens} token。按时间正序分批整理（早期记忆优先），每批完成即推进进度，可随时中止、退出不丢进度。
              </p>
              <div className="settings-row">
                <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void startBackfill()}>开始补处理</button>
                <button className="btn btn-secondary btn-sm" onClick={() => setPreview(null)} autoFocus>暂不</button>
              </div>
            </div>
          )}
          {status.lastError && <p className="ai-test-fail">上次整理出错：{status.lastError}</p>}
          {notice && <p className={notice.ok ? "ai-test-ok" : "ai-test-fail"}>{notice.text}</p>}
        </>
      )}

      {introOpen && (
        <div className="restore-confirm">
          <p className="restore-confirm-title">开启用户记忆前请了解</p>
          <p className="form-hint">
            ① 发送什么：日记中新增/改动的片段会发送给你配置的 AI 模型，由它整理成记忆条目；
            ② 何时发送：日记变更防抖后自动整理，以及应用启动时补跑；③ 发到哪里：仅你自己在「AI 服务」里配置的模型，
            软件不上传遥测；④ 记忆文件在 <span className="mono">{status?.memoryDir ?? "&lt;userData&gt;/memory/"}</span>，
            纯本地保存，可随时用外部编辑器查看修改，可随时关闭（关闭不删文件）。
          </p>
          <div className="settings-row">
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void confirmIntro()}>已知悉，开启</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setIntroOpen(false)} autoFocus>取消</button>
          </div>
        </div>
      )}
    </SettingsSection>
  );
}

// FSRS 参数优化（v12）：从复习记录训练个性化权重（fsrs-rs-nodejs），应用后调度即刻生效
function FSRSSection() {
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
          text: `训练完成：${result.reviewCount} 条复习记录（${result.cardCount} 张卡）。点击「应用」后新权重立即生效。`
        });
      } else {
        setNotice({ ok: false, text: result.error || "训练失败" });
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
      setNotice({ ok: true, text: "已应用优化权重，复习调度即刻使用新参数。" });
    } else {
      setNotice({ ok: false, text: "应用失败，请重试。" });
    }
  }

  async function handleReset() {
    const api = (window as unknown as { optimizerAPI?: { reset: () => Promise<{ ok: boolean; configId?: string }> } }).optimizerAPI!;
    const result = await api.reset();
    if (result?.ok) {
      setActiveSource("default");
      setNotice({ ok: true, text: "已恢复 FSRS 默认参数。" });
    } else {
      setNotice({ ok: false, text: "恢复失败，请重试。" });
    }
  }

  return (
    <SettingsSection id="sec-fsrs" title="FSRS 参数优化">
      {stats && (
        <p className="form-hint">
          复习记录 <span className="mono">{stats.reviewCount}</span> 条
          {stats.enough ? "，可优化" : `（建议 ${stats.minRecommended}+ 条后再优化）`}
        </p>
      )}
      <p className="form-hint">当前参数：{activeSource === "optimizer" ? "优化权重" : "默认参数"}</p>

      <div className="settings-row settings-row-wrap">
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={handleTrain}>
          {busy ? `训练中… ${progress !== null ? progress + "%" : ""}` : "开始优化"}
        </button>
        {trainedW && (
          <button className="btn btn-secondary btn-sm" onClick={handleApply}>
            应用优化结果
          </button>
        )}
        {activeSource === "optimizer" && (
          <button className="btn btn-outline btn-sm" onClick={handleReset}>
            恢复默认
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
    <SettingsSection id="sec-reader" title="阅读">
      <h4>阅读外观</h4>
      <div className="settings-row">
        <span className="settings-row-label">
          主题预设
          <SettingsInfo label="主题预设">与阅读器顶栏「主题」菜单读写同一份设置。</SettingsInfo>
        </span>
        <div className="seg-tabs">
          {(["paper", "sepia", "dark", "custom"] as const).map((t) => (
            <button key={t} className={a.theme === t ? "active" : ""} onClick={() => save({ ...cfg, appearance: { ...a, theme: t } })}>
              {t === "paper" ? "纸白" : t === "sepia" ? "羊皮" : t === "dark" ? "暗夜" : "自定义"}
            </button>
          ))}
        </div>
      </div>
      {a.theme === "custom" && (
        <div className="settings-row">
          <span>自定义色</span>
          <input type="color" value={a.bgColor || "#fafaf8"} onChange={(e) => save({ ...cfg, appearance: { ...a, bgColor: e.target.value } })} title="背景色" />
          <input type="color" value={a.fgColor || "#1a1a1a"} onChange={(e) => save({ ...cfg, appearance: { ...a, fgColor: e.target.value } })} title="文字色" />
        </div>
      )}
      <div className="settings-row">
        <span>字号（{a.fontSize ?? 17}px）</span>
        <input
          type="range"
          min={12}
          max={32}
          value={a.fontSize ?? 17}
          onChange={(e) => save({ ...cfg, appearance: { ...a, fontSize: Number(e.target.value) } })}
        />
      </div>
      <div className="form-field">
        <label>正文字体</label>
        <input
          value={a.fontFamily ?? ""}
          placeholder="留空使用默认多语言衬线栈"
          onChange={(e) => save({ ...cfg, appearance: { ...a, fontFamily: e.target.value } })}
        />
      </div>
      {/* D130 R3 P2/P3：行距（既有字段接 UI）+ 页边距 + 版心宽度——与阅读器快捷菜单读写同一字段；
          数值显示 mono + tabular-nums（.mono 的 font-feature-settings "tnum"），拖动时数字宽度不跳动 */}
      <div className="settings-row" data-reader-setting="lineHeight">
        <span className="settings-row-label">
          行距（<span className="mono">{a.lineHeight ?? 1.7}</span>）
          <SettingsInfo label="行距">正文行距（1.2–2.4）。摘录卡面行高恒跟随本设置（既有契约）；PDF 为固定版式，不适用。</SettingsInfo>
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
          页边距（<span className="mono">{a.margin ?? 48}px</span>）
          <SettingsInfo label="页边距">分页/对开模式的上下边带（0–120px）；滚动模式的排版余白由版心宽度承担；PDF 不适用。</SettingsInfo>
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
          版心宽度（<span className="mono">{a.maxInlineSize ?? 720}px</span>）
          <SettingsInfo label="版心宽度">滚动模式正文列最大宽度（480–1200px）＝「页边距」在滚动模式的对应物；720px ≈ 每行 42 个全角字。</SettingsInfo>
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
                  aria-label="重命名主题"
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
                    确认删除
                  </button>
                  <button type="button" className="reader-text-btn" autoFocus onClick={() => setConfirmId(null)}>
                    取消
                  </button>
                </span>
              ) : (
                <span className="reader-theme-manage-actions">
                  <button type="button" className="reader-text-btn" data-reader-theme-rename onClick={() => setRenameId(t.id)}>
                    重命名
                  </button>
                  <button type="button" className="reader-text-btn" data-reader-theme-delete onClick={() => setConfirmId(t.id)}>
                    删除
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="reader-theme-empty">在阅读器里把自定义色保存为主题后，会出现在这里。</p>
      )}

      <h4>选区与批注</h4>
      <div className="settings-row">
        <span className="settings-row-label">
          多段选择修饰键
          <SettingsInfo label="多段选择修饰键">按住它再选不相邻段＝加选；重复选＝移出；Esc 清空。Ctrl+Z/X/S/A/D 等纯键盘组合不受影响。</SettingsInfo>
        </span>
        <Dropdown
          value={multiKey ?? DEFAULT_MULTI_SELECT_KEY}
          align="left"
          options={MULTI_SELECT_KEYS.map((k) => ({
            value: k,
            label: k === "Meta" ? "Meta（macOS 的 Command）" : k
          }))}
          onChange={(v) => saveMultiKey(v as MultiSelectKey)}
        />
      </div>
      <div className="settings-row">
        <span className="settings-row-label">
          默认标注模式
          <SettingsInfo label="默认标注模式">高亮＝点色只做纯批注；摘录+高亮＝点色同时建一条摘录。都可在选区菜单里临时切换。</SettingsInfo>
        </span>
        <div className="seg-tabs">
          {([["highlight", "高亮"], ["extract", "摘录+高亮"]] as const).map(([id, label]) => (
            <button
              key={id}
              className={annot.annotateMode === id ? "active" : ""}
              data-annot-mode={id}
              onClick={() => saveAnnot("annotateMode", id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="settings-row">
        <span className="settings-row-label">
          默认标注形式
          <SettingsInfo label="默认标注形式">高亮＝底色；下划线＝批注色 2px 色线。都可在选区菜单里临时切换。</SettingsInfo>
        </span>
        <div className="seg-tabs">
          {([["highlight", "高亮"], ["underline", "下划线"]] as const).map(([id, label]) => (
            <button
              key={id}
              className={annot.annotateForm === id ? "active" : ""}
              data-annot-form={id}
              onClick={() => saveAnnot("annotateForm", id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="settings-row">
        <span className="settings-row-label">
          批注色板
          <SettingsInfo label="批注色板">勾选的颜色与顺序＝调色排里出现的颜色与顺序；点色即执行当前模式的动作。</SettingsInfo>
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
                title={on ? `${c}（点击移出色板）` : `${c}（点击加入色板，最多 8 支）`}
                style={{ background: `var(--annot-${c})` }}
                onClick={() => saveAnnot("annotatePalette", togglePaletteColor(annot.annotatePalette, c))}
              />
            );
          })}
        </div>
      </div>
      <div className="settings-row">
        <span className="settings-row-label">
          自定义取色
          <SettingsInfo label="自定义取色">调色排末位是否显示「自定义…」入口。</SettingsInfo>
        </span>
        <div className="seg-tabs">
          {([[true, "显示"], [false, "隐藏"]] as const).map(([id, label]) => (
            <button
              key={String(id)}
              className={annot.annotateCustomEnabled === id ? "active" : ""}
              data-annot-custom={String(id)}
              onClick={() => saveAnnot("annotateCustomEnabled", id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="settings-row">
        <span className="settings-row-label">
          批注栏默认筛选
          <SettingsInfo label="批注栏默认筛选">批注栏打开时的初始筛选；栏顶段控与本键同一份设置。</SettingsInfo>
        </span>
        <div className="seg-tabs">
          {([["all", "全部"], ["extract", "摘录"], ["highlight", "高亮"]] as const).map(([id, label]) => (
            <button
              key={id}
              className={annot.annotationFilter === id ? "active" : ""}
              data-annot-filter={id}
              onClick={() => saveAnnot("annotationFilter", id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {/* D122：选区浮条里「批注/制卡/AI 制卡/AI 解释/查词」的呈现——图标（默认）或文字 */}
      <div className="settings-row">
        <span className="settings-row-label">
          选区浮条按钮样式
          <SettingsInfo label="选区浮条按钮样式">选中文字时出现在文字旁的浮条里，动作按钮用图标（悬停显示名称）或文字标签。</SettingsInfo>
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
              {label}
            </button>
          ))}
        </div>
      </div>

      <h4>摘录卡编辑器</h4>
      {/* D95 §E：摘录卡编辑器下方的富文本工具栏开关（关＝整行不渲染，markdown 语法输入不受影响） */}
      <div className="settings-row">
        <span className="settings-row-label">
          摘录卡编辑工具栏
          <SettingsInfo label="摘录卡编辑工具栏">编辑时选中文字即可用工具条加粗/标题/列表/公式等；关闭后仍可用 markdown 语法输入与快捷键。</SettingsInfo>
        </span>
        <label className="widget-toggle-main">
          <input
            type="checkbox"
            data-testid="setting-extract-editor-toolbar"
            checked={ext.extractEditorToolbar}
            onChange={(e) => saveExtract({ ...ext, extractEditorToolbar: e.target.checked })}
          />
          <span>编辑时显示</span>
        </label>
      </div>
      {/* D95 v1.4→§K.3：工具栏形态——dock（钉底/钉顶）/悬浮＝选区锚定弹层 */}
      <div className="settings-row">
        <span className="settings-row-label">
          工具栏形态
          <SettingsInfo label="工具栏形态">悬浮＝工具条弹层锚定当前选中的文字；关闭＝随文档流固定在顶部或底部。</SettingsInfo>
        </span>
        <label className="widget-toggle-main">
          <input
            type="checkbox"
            data-testid="setting-extract-editor-toolbar-float"
            checked={ext.extractEditorToolbarFloat}
            onChange={(e) => saveExtract({ ...ext, extractEditorToolbarFloat: e.target.checked })}
          />
          <span>悬浮于选中文字</span>
        </label>
      </div>
      {/* §K.2：dock 态钉底/钉顶（悬浮态优先于本键；钉顶时工具条吸顶并让开吸顶头带） */}
      <div className="settings-row">
        <span className="settings-row-label">
          工具栏固定位置（非悬浮时）
          <SettingsInfo label="工具栏固定位置">开启＝钉顶（吸顶并让开吸顶头带）；关闭＝钉底。悬浮形态优先于本键。</SettingsInfo>
        </span>
        <label className="widget-toggle-main">
          <input
            type="checkbox"
            data-testid="setting-extract-editor-toolbar-top"
            checked={ext.extractEditorToolbarTop}
            onChange={(e) => saveExtract({ ...ext, extractEditorToolbarTop: e.target.checked })}
          />
          <span>固定在顶部</span>
        </label>
      </div>
      {/* D95 §F.2：摘录卡字号——默认跟随阅读界面，可独立自定义字号/字体（行高恒跟随） */}
      <div className="settings-row">
        <span>摘录卡字号</span>
        <label className="widget-toggle-main">
          <input
            type="checkbox"
            data-testid="setting-extract-font-follow"
            checked={ext.extractFaceFontFollow}
            onChange={(e) => saveExtract({ ...ext, extractFaceFontFollow: e.target.checked })}
          />
          <span>跟随阅读界面字号/字体</span>
        </label>
      </div>
      {!ext.extractFaceFontFollow && (
        <>
          <div className="settings-row">
            <span>摘录卡字号（{ext.extractFaceFontSize}px）</span>
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
            <label>摘录卡字体</label>
            <input
              data-testid="setting-extract-font-family"
              value={ext.extractFaceFontFamily}
              placeholder="留空使用应用默认字体"
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
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  async function openFolder() {
    try {
      const ok = await logsAPI().openFolder();
      setNotice(
        ok
          ? { ok: true, text: "已在系统文件管理器中打开日志文件夹。" }
          : { ok: false, text: "打开日志文件夹失败，请重试。" }
      );
    } catch (err) {
      setNotice({ ok: false, text: `打开日志文件夹失败：${err instanceof Error ? err.message : String(err)}` });
    }
  }
  return (
    <SettingsSection id="sec-logs" title="日志">
      <p className="form-hint">
        软件运行与错误信息记录在本地日志文件中（只含时间、错误消息与运行状态，不含书籍内容）。
        遇到问题时，可将日志文件发送给开发者协助排查。
      </p>
      <div className="settings-row">
        <button className="btn btn-outline btn-sm" onClick={openFolder}>
          打开日志文件夹
        </button>
      </div>
      {notice && <p className={notice.ok ? "ai-test-ok" : "ai-test-fail"}>{notice.text}</p>}
    </SettingsSection>
  );
}

function BackupSection() {
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
          text: r.skipped ? "今日自动备份已存在，无需重复。" : `备份完成：${r.file?.split(/[\\/]/).pop() ?? ""}`
        });
        await reload();
      } else {
        setNotice({ ok: false, text: `备份失败：${r.error}` });
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
          text: `恢复完成（当前数据已安全备份至 ${r.safetyFile?.split(/[\\/]/).pop() ?? ""}）。重启应用后生效——重启前请勿继续使用软件。`
        });
        await reload();
      } else {
        setNotice({ ok: false, text: `恢复失败：${r.error}` });
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
    <SettingsSection id="sec-backup" title="数据备份与恢复">
      {info && (
        <p className="form-hint">
          当前数据：<span className="mono">{info.counts.items}</span> 本书 ·{" "}
          <span className="mono">{info.counts.cards}</span> 张卡 ·{" "}
          <span className="mono">{info.counts.extracts}</span> 条摘录（库{" "}
          <span className="mono">{fmtBytes(info.dbBytes)}</span>，资产{" "}
          <span className="mono">{fmtBytes(info.assetBytes)}</span>）
        </p>
      )}

      <div className="backup-toolbar">
        <button className="btn btn-primary btn-sm" disabled={busy !== "" || restored} onClick={doBackup}>
          {busy === "backup" ? "备份中…" : "立即备份"}
        </button>
        <label className="backup-checkline">
          <input type="checkbox" checked={includeKey} onChange={(e) => setIncludeKey(e.target.checked)} />
          包含 AI Key（ai-config.json，默认不备）
        </label>
        <button className="btn btn-outline btn-sm" onClick={() => backupAPI().openDir()}>打开备份文件夹</button>
        <button className="btn btn-outline btn-sm" onClick={changeDir}>更改备份位置</button>
      </div>
      {list && (
        <p className="form-hint settings-block">
          备份位置：<span className="mono">{list.backupDir}</span>
        </p>
      )}

      <div className="backup-toolbar settings-block">
        <span className="backup-row-title">每日首次启动自动备份</span>
        <div className="seg-tabs seg-tabs-sm" role="group" aria-label="自动备份开关">
          <button className={autoOn ? "active" : ""} onClick={() => toggleAuto(true)}>开</button>
          <button className={!autoOn ? "active" : ""} onClick={() => toggleAuto(false)}>关</button>
        </div>
        <span className="backup-row-title">保留</span>
        <input
          className="mono input-num"
          type="number"
          min={1}
          max={90}
          value={keep}
          onChange={(e) => changeKeep(Number(e.target.value))}
        />
        <span className="backup-row-title">份（超出删最旧）</span>
      </div>

      {confirmFile && (
        <div className="restore-confirm">
          <p className="restore-confirm-title">确认恢复</p>
          <p className="form-hint">
            将用「<span className="mono">{confirmFile.name}</span>」覆盖当前全部数据（书架、卡片、复习记录、摘录、设置）。
            恢复前会自动安全备份当前数据；完成后需重启应用生效，重启前请勿继续使用软件。
          </p>
          <div className="settings-row">
            <button className="btn btn-danger btn-sm" disabled={busy !== ""} onClick={doRestore}>
              {busy === "restore" ? "恢复中…" : "确认恢复"}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setConfirmFile(null)} autoFocus>取消</button>
          </div>
        </div>
      )}

      {notice && <p className={notice.ok ? "ai-test-ok" : "ai-test-fail"}>{notice.text}</p>}
      {restored && (
        <div className="settings-row settings-block">
          <button className="btn btn-primary btn-sm" onClick={() => backupAPI().relaunch()}>重启应用</button>
        </div>
      )}

      {list && list.backups.length > 0 && (
        <div className="backup-list">
          {list.backups.map((b) => (
            <div className="backup-row" key={b.path}>
              <div className="backup-row-main">
                <span className="backup-row-title">
                  <span className="backup-tag">{BACKUP_LABEL[b.label] || b.label}</span>
                  {fmtTime(b.createdAt)}
                  {b.includesAIConfig && " · 含 Key"}
                  {!b.valid && " · 清单损坏"}
                </span>
                <span className="backup-row-sub">
                  {fmtBytes(b.sizeBytes)}
                  {b.counts ? ` · ${b.counts.items} 书 · ${b.counts.cards} 卡` : ""}
                  {typeof b.assetFiles === "number" ? ` · ${b.assetFiles} 资产` : ""}
                </span>
              </div>
              <button
                className="btn btn-danger-outline btn-sm"
                disabled={busy !== "" || restored}
                onClick={() => setConfirmFile({ path: b.path, name: b.file })}
              >
                恢复
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="settings-row settings-block">
        <button className="btn btn-danger-outline btn-sm" disabled={restored} onClick={pickRestoreFile}>
          从备份文件恢复…
        </button>
      </div>
    </SettingsSection>
  );
}

// ---------- 词典与查词（v32，D31；v48.70/D114 由「词典/下载」改名）----------
function DictSection() {
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
            ? `词典已下载并建好索引（已索引 ${msg.count ?? 0} 词条，达到安全上限有截断），选中单词即可查词`
            : `词典已下载并建好索引（共 ${msg.count ?? 0} 词条），选中单词即可查词（本地优先于在线超时）`
        );
        refreshSources();
      }
      if (msg.state === "saved") {
        setBusy(null);
        setNotice("文件已下载，但该格式暂不支持自动建索引（已存于 dicts 目录）");
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
      setNotice(r ? `已导入「${r.name}」（${r.count} 词条），可在阅读器选中查词` : "导入取消");
      refreshSources();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <SettingsSection id="sec-dict" title="词典与查词">
      <div className="settings-row">
        <span className="settings-row-label">
          词典来源
          <SettingsInfo label="词典来源">本地＝不联网；在线＝Free Dictionary / Jisho；自动＝在线优先，失败/超时回落本地。</SettingsInfo>
        </span>
        <div className="seg-tabs" role="radiogroup" aria-label="词典来源">
          {(["local", "online", "auto"] as const).map((m) => (
            <button key={m} className={mode === m ? "active" : ""} onClick={() => changeMode(m)}>
              {m === "local" ? "本地词典" : m === "online" ? "在线词典" : "自动"}
            </button>
          ))}
        </div>
      </div>

      <h4>
        弹窗显示字段
        <SettingsInfo label="弹窗显示字段">默认开拼写/音标/发音/释义；例句关闭不影响原句保存与挖空卡。</SettingsInfo>
      </h4>
      <div className="settings-row check-row">
        {FIELD_LABELS.map((f) => (
          <label key={f.key} className="check-inline">
            <input type="checkbox" checked={!!fields[f.key]} onChange={() => toggleField(f.key)} />
            {f.label}
          </label>
        ))}
      </div>

      <h4>单词卡发音</h4>
      <div className="settings-row">
        <span className="settings-row-label">
          发音来源
          <SettingsInfo label="发音来源">TTS＝离线可用（Windows 需语言语音包）；在线＝真人音频，缺失时回落 TTS。</SettingsInfo>
        </span>
        <div className="seg-tabs" role="radiogroup" aria-label="发音来源">
          <button className={audioSource === "tts" ? "active" : ""} onClick={() => changeAudioSource("tts")}>系统 TTS</button>
          <button className={audioSource === "online" ? "active" : ""} onClick={() => changeAudioSource("online")}>在线音频</button>
        </div>
      </div>
      <div className="settings-row">
        <label className="check-inline">
          <input type="checkbox" checked={autoSpeak} onChange={(e) => changeAutoSpeak(e.target.checked)} />
          自动发音（出到单词卡即朗读，无需手动点击）
        </label>
      </div>

      <h4>
        一键下载
        <SettingsInfo label="一键下载">版权不明的第三方包（StarDict 朗道/牛津等）仅本地导入；Wiktionary 全量仅在线 API。</SettingsInfo>
      </h4>
      {DICT_CATALOG.filter((c) => c.suitable === "download").map((c) => {
        const pg = progress[c.id];
        return (
          <div key={c.id} className="dict-catalog-row">
            <div>
              <div><strong>{c.name}</strong> <span className="mono">{c.estSizeLabel}</span> <span className="dict-tag">{c.recommendLevel}</span></div>
              <div className="form-hint">{c.desc}。{c.recommend}（{c.license}，{c.updateFreq}）</div>
              {pg && (pg.state === "downloading" || pg.state === "indexing") && (
                <div className="mono">
                  {pg.state === "downloading" ? `下载中… ${pg.progress}%` : `建索引中… 已 ${pg.count ?? 0} 词条（期间界面保持响应）`}
                </div>
              )}
            </div>
            <button className="btn btn-outline btn-sm" disabled={busy === c.id} onClick={() => download(c)}>
              {busy === c.id ? "下载中…" : sources.some((s) => s.name === c.name) ? "更新" : "下载"}
            </button>
          </div>
        );
      })}
      <div className="settings-row">
        <button className="btn btn-outline btn-sm" onClick={importLocal}>本地导入词典文件…</button>
      </div>

      {sources.length > 0 && (
        <>
          <h4>已安装词典</h4>
          {sources.map((s) => (
            <div key={s.id} className="dict-catalog-row">
              <div>
                <strong>{s.name}</strong> <span className="mono">{s.format}{s.lang ? ` · ${s.lang}` : ""} · {s.entry_count} 词条</span>
                {Number(s.entry_count) === 0 && <div className="form-hint">未建索引——点右侧「更新」重新下载解析，或删除后本地导入。</div>}
              </div>
              <div className="row-actions">
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => window.dictAPI?.toggleSource(s.id, !s.enabled).then(refreshSources)}
                >
                  {s.enabled ? "停用" : "启用"}
                </button>
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => window.dictAPI?.removeSource(s.id).then(refreshSources)}
                >
                  删除
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
      title="快捷键"
      info={
        <SettingsInfo label="快捷键">
          点键位框后按新组合键（Esc 取消）；与其他动作冲突的键位不会被保存；输入框内的编辑键不受影响。
        </SettingsInfo>
      }
    >
      <div className="settings-row settings-block-b">
        <button className="btn btn-outline btn-sm" onClick={resetAllBindings}>全部恢复默认</button>
      </div>
      <h4>应用内快捷键</h4>
      {groups.map(([label, defs]) => (
        <div key={label} className="kb-group">
          <div className="kb-group-label mono">{label}</div>
          {defs.map((def) => {
            const binding = bindings[def.id] ?? def.defaultKey;
            const customized = binding !== def.defaultKey;
            const conflictMsg = conflict?.id === def.id ? `与「${conflict.with}」冲突` : null;
            return (
              <div className="kb-row" key={def.id}>
                <span className="kb-row-title">{def.title}</span>
                {conflictMsg && <span className="kb-conflict">{conflictMsg}</span>}
                <button
                  className={`kb-key mono${capturing === def.id ? " capturing" : ""}`}
                  title="点击后按下新键位"
                  onClick={() => { setConflict(null); setCapturing(def.id); }}
                >
                  {capturing === def.id ? "按下新键…" : binding}
                </button>
                <button
                  className="btn btn-secondary btn-sm kb-reset"
                  disabled={!customized}
                  title="恢复默认键位"
                  onClick={() => resetOne(def.id)}
                >
                  恢复
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

// ---------- v36（M8-A，§5.4 / D34）：全局快捷键组（快速记录 / 添加学习材料）+ 随系统启动 ----------
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

function shortcutStateLabel(s?: { enabled: boolean; registered: boolean; error: string | null }): {
  text: string;
  cls: string;
} {
  if (!s) return { text: "—", cls: "" };
  if (!s.enabled) return { text: "已关闭", cls: "" };
  if (s.registered) return { text: "已注册", cls: " on" };
  return { text: s.error ? "被占用" : "未注册", cls: " err" };
}

// D123：关闭主窗口＝收进系统托盘（默认开）；关闭则点关闭按钮直接退出应用
function TrayRow() {
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
        关闭窗口时收进系统托盘继续运行（托盘菜单「退出」才真正退出）
      </label>
    </div>
  );
}

function GlobalShortcutsBlock() {
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
        setConflict({ target, message: "需带 Ctrl / Alt / Shift 修饰键（或使用 F1–F24）" });
        return;
      }
      setCapturing(null);
      const current = cfgRef.current;
      const others = (["quickCapture", "addMaterial", "workbench"] as const)
        .filter((k) => k !== target)
        .map((k) => current[k].accelerator);
      if (others.includes(combo)) {
        setConflict({ target, message: "与另一个全局快捷键相同" });
        return;
      }
      const hit = commandRegistry.conflictWith(combo, "");
      if (hit) {
        setConflict({ target, message: `与应用内「${hit.title}」冲突` });
        return;
      }
      setConflict(null);
      const next: GlobalShortcutsConfig = { ...current, [target]: { ...current[target], accelerator: combo } };
      void persist(next, target);
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing]);

  const capture = shortcutStateLabel(status?.quickCapture);
  const add = shortcutStateLabel(status?.addMaterial);
  const wbs = shortcutStateLabel(status?.workbench);

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
          title={enabled ? "点击后按下新组合键" : "该快捷键已关闭"}
          disabled={!enabled}
          onClick={() => {
            setConflict(null);
            setCapturing(target);
          }}
        >
          {capturing === target ? "按下新键…" : binding}
        </button>
        <button className="btn btn-secondary btn-sm kb-reset" disabled={isDefault} title="恢复默认" onClick={reset}>
          恢复
        </button>
      </>
    );
  }

  return (
    <div id="sec-global">
      <h4>
        全局快捷键
        <SettingsInfo label="全局快捷键">
          软件无焦点时也生效（需运行中，可配合「随系统启动」）；状态「被占用」＝系统层冲突，换一个组合即可。
        </SettingsInfo>
      </h4>

      <div className="kb-group">
        <div className="kb-row">
          <label className="kb-row-title gs-check">
            <input
              type="checkbox"
              checked={cfg.quickCapture.enabled}
              onChange={(e) =>
                void persist({ ...cfg, quickCapture: { ...cfg.quickCapture, enabled: e.target.checked } })
              }
            />
            快速记录（随想随记，弹出小窗）
          </label>
          {conflict?.target === "quickCapture" && <span className="kb-conflict">{conflict.message}</span>}
          {renderKeyButton("quickCapture", cfg.quickCapture.enabled)}
          <span className={`gs-state mono${capture.cls}`}>{capture.text}</span>
        </div>

        <label className="gs-check gs-check-sub">
          <input
            type="checkbox"
            checked={cfg.quickCapture.hideOnBlur}
            onChange={(e) =>
              void persist({ ...cfg, quickCapture: { ...cfg.quickCapture, hideOnBlur: e.target.checked } })
            }
          />
          失焦时自动隐藏窗口
          <SettingsInfo label="失焦时自动隐藏">内容已即时保存；不勾选则需按 Esc 关闭。</SettingsInfo>
        </label>

        <div className="kb-row">
          <label className="kb-row-title gs-check">
            <input
              type="checkbox"
              checked={cfg.addMaterial.enabled}
              onChange={(e) => void persist({ ...cfg, addMaterial: { ...cfg.addMaterial, enabled: e.target.checked } })}
            />
            添加学习材料（弹出「添加书籍」）
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
            制卡台（弹出独立窗口：手动制卡 / AI 制卡 / AI 解释）
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
            随系统启动（开机自动运行，保证全局快捷键随时可用）
          </label>
          <span className={`gs-state mono${status?.autoLaunch ? " on" : ""}`}>
            {status?.autoLaunch ? "已开启" : "已关闭"}
          </span>
        </div>
      </div>

      <TrayRow />

      <div className="settings-row settings-block">
        <button className="btn btn-outline btn-sm" onClick={() => void shortcutsApi.toggleCapture()}>
          试一下快速记录
        </button>
        <button className="btn btn-outline btn-sm" onClick={() => void window.windowAPI?.workbench?.("toggle")}>
          试一下制卡台窗口
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
    if (r && !r.ok) setActErr({ id, reason: r.reason || "激活失败" });
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
      <h4>主题插件</h4>
      <p className="form-hint">
        主题插件来自应用数据目录的 plugins 文件夹（本期仅支持主题插件 type:theme，样式经宿主校验后注入）。
        与内置皮肤互斥——启用一方即停用另一方。
      </p>
      {plugins.length === 0 && <p className="form-hint">尚未发现插件：把插件文件夹放入 plugins 目录后点「重新扫描」。</p>}
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
                    停用
                  </button>
                ) : (
                  <button type="button" className="plugin-text-btn" data-plugin-activate onClick={() => void activate(p.id)}>
                    启用
                  </button>
                )
              ) : (
                <button type="button" className="plugin-text-btn" disabled title={p.reason}>
                  启用
                </button>
              )}
              <span className="plugin-item-state">{p.active ? "已激活" : p.status === "ok" ? "未激活" : "校验失败"}</span>
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
          打开插件文件夹
        </button>
        <button type="button" className="btn btn-outline btn-sm" data-plugin-rescan onClick={() => void reload.current()}>
          重新扫描
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
  onClose
}: Props) {
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
        data-show={show ? "in" : "out"}
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="设置"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>设置</h2>
          <button className="icon-btn modal-close" title="关闭" aria-label="关闭设置" onClick={requestClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <div className="settings-layout modal-scroll" ref={layoutRef}>
          <nav className="settings-nav" aria-label="设置分区">
            {SECTION_GROUPS.map((g) => (
              <Fragment key={g.label}>
                {/* 组标题：非交互 div，不进 Tab 序、不进 .settings-nav button 查询集（§5.4） */}
                <div className="settings-nav-group">{g.label}</div>
                {g.items.map((s) => (
                  <button
                    key={s.id}
                    className={activeNav === s.id ? "active" : ""}
                    aria-current={activeNav === s.id ? "true" : undefined}
                    onClick={() => jumpTo(s.id)}
                  >
                    {s.label}
                  </button>
                ))}
              </Fragment>
            ))}
          </nav>

          <div className="settings-content">
            <SettingsSection id="sec-appearance" title="主题与颜色">
              <h4>主题模式</h4>
              <div className="seg-tabs">
                <button className={theme === "light" ? "active" : ""} onClick={() => onThemeChange("light")}>
                  浅色
                </button>
                <button className={theme === "dark" ? "active" : ""} onClick={() => onThemeChange("dark")}>
                  深色
                </button>
              </div>
              <h4>皮肤</h4>
              <div className="skin-list">
                {SKINS.map((s) => (
                  <button
                    key={s.id}
                    className={skinId === s.id ? "active" : ""}
                    onClick={() => onSkinChange(s.id)}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
              {/* v48.89（D132 §8.1）：主题插件子块——落位 sec-appearance 内「皮肤」与「强调色」之间，
                  不新增 SECTION_GROUPS 导航项（D114 的 5 组契约零改动）、不新增 sec-* 锚 */}
              <ThemePluginsBlock />
              <h4>强调色</h4>
              <div className="settings-row accent-row">
                <input type="color" value={accentColor || "#166a59"} onChange={(e) => onAccentChange(e.target.value)} />
                <button className="btn btn-secondary btn-sm" onClick={() => onAccentChange("")}>恢复默认</button>
              </div>
            </SettingsSection>

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
            <MemorySection />

            {/* 数据与效率 */}
            <BackupSection />
            <LogsSection />
            <ShortcutsSection />
            <DashboardSection />
            {/* v48.81（D125，用户指令）：实验功能——学习者知识模型设置迁入（sec-learner 子块 id 保留），
                与既有实验项同带「早期开发阶段」标识；左栏按钮 14 → 15 */}
            <SettingsSection id="sec-lab" title="实验功能">
              <p className="form-hint">实验功能 · 早期开发阶段。</p>
              <div id="sec-learner">
                <LearnerBlock />
              </div>
            </SettingsSection>
          </div>
        </div>
      </div>
    </div>
  );
}
