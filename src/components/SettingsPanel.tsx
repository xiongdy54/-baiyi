import { useEffect, useRef, useState } from "react";
import { SKINS } from "../skins";
import { aiGateway, type AIConfig } from "../lib/ai";
import { settingsStore } from "../lib/settings";
import { commandRegistry, eventToCombo, type CommandDef } from "../lib/commands";
import { WIDGETS } from "./dashboard/widgets";
import Dropdown from "./Dropdown";
import { DEFAULT_READER_SETTINGS, type ReaderSettings } from "../lib/reader/service";
import type { DashLayoutV2, WidgetSize } from "./dashboard/layout";

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

const PRESET_OPTIONS = [
  { id: "goat", label: "Command Code GOAT Plan", hint: "api.commandcode.ai/provider/v1 · 默认模型 z-ai/glm-5.3-flash" },
  { id: "zai", label: "智谱官方 API（bigmodel.cn）", hint: "open.bigmodel.cn · 默认免费模型 glm-4.7-flash" },
  { id: "local", label: "本地模型（Ollama / LM Studio）", hint: "零排队零成本 · 8GB 显存推荐 qwen3:8b" },
  { id: "custom", label: "通用 API Key（OpenAI 兼容）", hint: "自填 Base URL 与模型名" }
];

function SkeletonBlock({ h = 40 }: { h?: number }) {
  return <div className="skeleton" style={{ height: h }} />;
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

  if (!loaded) return <SkeletonBlock h={120} />;

  return (
    <>
      <section className="settings-section" id="sec-widgets">
        <h3>显示哪些组件</h3>
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
        <p className="form-hint">宽幅 = 统计页通栏一行；窄幅 = 半幅，相邻窄幅自动两两成行。所有图表显示在顶栏「统计数据」页，拖动组件标题栏可交换位置。</p>
      </section>

      <section className="settings-section" id="sec-dashreset">
        <h3>重置布局</h3>
        <div className="settings-row">
          <button className="btn btn-secondary btn-sm" onClick={resetLayout}>恢复默认排列与宽度</button>
        </div>
      </section>
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
  const [busy, setBusy] = useState<"" | "save" | "test" | "models">("");
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
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
    const next = await doSave();
    setBusy("");
    return next;
  }

  async function handleTest() {
    setNotice(null);
    setModelsOpen(false);
    setBusy("test");
    const saved = await doSave();
    if (!saved || (saved.preset !== "local" && !saved.hasKey)) {
      setBusy("");
      setNotice({ ok: false, text: "请先粘贴 API Key，点击「保存配置」后再测试" });
      return;
    }
    const result = await aiGateway.test();
    setBusy("");
    setNotice({ ok: result.ok, text: result.ok ? "✓ 连接正常，AI 制卡 / 解释可用" : `✗ ${result.message}` });
  }

  async function handleFetchModels() {
    setNotice(null);
    setBusy("models");
    await doSave();
    try {
      const list = await aiGateway.listModels();
      setModels(list);
      setModelFilter("");
      setModelsOpen(list.length > 0);
      setNotice({
        ok: true,
        text: list.length > 0 ? `已拉取 ${list.length} 个模型 — 点击「模型名」框从列表选择` : "服务未返回模型列表，请手输"
      });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : String(err) });
    }
    setBusy("");
  }

  if (!cfg) return null;

  const filtered = modelFilter
    ? models.filter((m) => m.toLowerCase().includes(modelFilter.toLowerCase()))
    : models;

  return (
    <section className="settings-section" id="sec-ai">
      <h3>AI 服务</h3>

      <div className="skin-list">
        {PRESET_OPTIONS.map((p) => (
          <button
            key={p.id}
            className={cfg.preset === p.id ? "active" : ""}
            onClick={() => save({ preset: p.id })}
          >
            <span className="ai-preset-name">{p.label}</span>
            <span className="ai-preset-hint">{p.hint}</span>
          </button>
        ))}
      </div>

      {cfg.preset === "goat" && (
        <p className="form-hint">
          在{" "}
          <a href="https://commandcode.ai/xiongdy54/settings/keys" target="_blank" rel="noreferrer">
            commandcode.ai → Studio → API Keys
          </a>{" "}
          创建 Key。
        </p>
      )}

      {cfg.preset === "zai" && (
        <p className="form-hint">
          在{" "}
          <a href="https://bigmodel.cn/apikey/platform" target="_blank" rel="noreferrer">
            智谱开放平台
          </a>{" "}
          创建 Key。<span className="mono">glm-4.7-flash</span> 免费。
        </p>
      )}

      {cfg.preset === "local" && (
        <p className="form-hint">
          需本机运行 Ollama（默认端口 11434）或 LM Studio（端口 1234）。
        </p>
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
            <label>服务地址（Ollama 默认 11434，LM Studio 默认 1234）</label>
            <input
              className="mono"
              value={cfg.baseUrl}
              placeholder="http://localhost:11434/v1"
              onChange={(e) => setCfg({ ...cfg, baseUrl: e.target.value })}
            />
            {!/\/v\d+$/.test(cfg.baseUrl.trim()) && (
              <p className="ai-test-fail" style={{ marginTop: "var(--sp-1)" }}>
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
              placeholder={cfg.preset === "goat" ? "z-ai/glm-5.3-flash" : "模型名（可手输）"}
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
            <label>API Key {cfg.hasKey ? "（已保存 ✓）" : "（尚未保存 — 填好后点「保存配置」）"}</label>
            <input
              type="password"
              value={apiKey}
              placeholder={cfg.hasKey ? "••••••••" : "cmd-… / sk-…"}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>
        )}
      </div>

      <div className="settings-row" style={{ flexWrap: "wrap" }}>
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
    </section>
  );
}

// 学习日（v23，D21/§4.4.8）：统计口径的「新一天」起点 = 本地钟面 0-23 时，默认 0（午夜）。
// 仅影响统计（今日完成度/热力/日聚合）；FSRS 调度间隔与优化训练不受其影响。
function LearningDaySection() {
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
    <section className="settings-section" id="sec-learningday">
      <h3>学习日（新一天开始时刻）</h3>
      <p className="form-hint">
        统计口径：每日该时刻起算「新的一天」——学习到深夜时，凌晨的学习仍计入前一天。仅影响统计与热力图，不影响 FSRS 复习间隔。
      </p>
      <div className="settings-row">
        <span>新一天从</span>
        {cutoff !== null && (
          <Dropdown value={String(cutoff)} options={options} align="left" onChange={update} title="学习日切点" />
        )}
      </div>
      {savedTick % 2 === 1 && <p className="ai-test-ok">已保存，统计口径即时生效。</p>}
    </section>
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
    <section className="settings-section" id="sec-fsrs">
      <h3>FSRS 参数优化</h3>
      {stats && (
        <p className="form-hint">
          复习记录 <span className="mono">{stats.reviewCount}</span> 条
          {stats.enough ? "，可优化" : `（建议 ${stats.minRecommended}+ 条后再优化）`}
        </p>
      )}
      <p className="form-hint">当前参数：{activeSource === "optimizer" ? "优化权重" : "默认参数"}</p>

      <div className="settings-row" style={{ flexWrap: "wrap" }}>
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
    </section>
  );
}

// ---------- 阅读外观（v20 R1b）：与阅读器快捷控件共用 settings.app.readerSettings ----------
function ReaderSection() {
  const [cfg, setCfg] = useState<ReaderSettings | null>(null);
  useEffect(() => {
    settingsStore
      .get<ReaderSettings>("app", "readerSettings", DEFAULT_READER_SETTINGS)
      .then((s) =>
        setCfg({
          mode: { ...DEFAULT_READER_SETTINGS.mode, ...s.mode },
          appearance: { ...DEFAULT_READER_SETTINGS.appearance, ...s.appearance }
        })
      )
      .catch(() => setCfg(DEFAULT_READER_SETTINGS));
  }, []);
  const save = (next: ReaderSettings) => {
    setCfg(next);
    void settingsStore.set("app", "readerSettings", next);
  };
  if (!cfg) return null;
  const a = cfg.appearance;
  return (
    <section className="settings-section" id="sec-reader">
      <h3>阅读（书与摘录的阅读视图）</h3>
      <p className="form-hint">
        阅读器顶栏的「主题」快捷菜单与本区块读写同一份设置；自定义色直接作用于正文背景与文字。
      </p>
      <div className="settings-row">
        <span>主题预设</span>
        <div className="seg-tabs" style={{ padding: 0 }}>
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
      <div className="settings-row">
        <span>正文字体</span>
        <input
          style={{ flex: 1 }}
          value={a.fontFamily ?? ""}
          placeholder="留空使用默认多语言衬线栈"
          onChange={(e) => save({ ...cfg, appearance: { ...a, fontFamily: e.target.value } })}
        />
      </div>
    </section>
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
    <section className="settings-section" id="sec-backup">
      <h3>数据备份与恢复</h3>
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
        <p className="form-hint" style={{ marginTop: "var(--sp-2)" }}>
          备份位置：<span className="mono">{list.backupDir}</span>
        </p>
      )}

      <div className="backup-toolbar" style={{ marginTop: "var(--sp-3)" }}>
        <span className="backup-row-title">每日首次启动自动备份</span>
        <div className="seg-tabs seg-tabs-sm" role="group" aria-label="自动备份开关">
          <button className={autoOn ? "active" : ""} onClick={() => toggleAuto(true)}>开</button>
          <button className={!autoOn ? "active" : ""} onClick={() => toggleAuto(false)}>关</button>
        </div>
        <span className="backup-row-title">保留</span>
        <input
          className="mono"
          type="number"
          min={1}
          max={90}
          value={keep}
          style={{ width: 64, height: 32, padding: "0 var(--sp-2)" }}
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
            <button className="btn btn-primary btn-sm" disabled={busy !== ""} onClick={doRestore}>
              {busy === "restore" ? "恢复中…" : "确认恢复"}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setConfirmFile(null)}>取消</button>
          </div>
        </div>
      )}

      {notice && <p className={notice.ok ? "ai-test-ok" : "ai-test-fail"}>{notice.text}</p>}
      {restored && (
        <div className="settings-row" style={{ marginTop: "var(--sp-2)" }}>
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
                className="btn btn-secondary btn-sm"
                disabled={busy !== "" || restored}
                onClick={() => setConfirmFile({ path: b.path, name: b.file })}
              >
                恢复
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="settings-row" style={{ marginTop: "var(--sp-3)" }}>
        <button className="btn btn-outline btn-sm" disabled={restored} onClick={pickRestoreFile}>
          从备份文件恢复…
        </button>
      </div>
    </section>
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
    <section className="settings-section" id="sec-shortcuts">
      <h3>快捷键</h3>
      <p className="form-hint">
        点击键位框后按下新的组合键（Esc 取消）；与其他动作冲突的键位不会被保存。
        输入框内的 Ctrl+Z / Ctrl+A 等编辑键不受影响。
      </p>
      <div className="settings-row" style={{ marginBottom: "var(--sp-3)" }}>
        <button className="btn btn-outline btn-sm" onClick={resetAllBindings}>全部恢复默认</button>
      </div>
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
    </section>
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
  const sections = [
    { id: "appearance", label: "外观" },
    { id: "reader", label: "阅读" },
    { id: "dashboard", label: "统计仪表盘" },
    { id: "learningday", label: "学习日" },
    { id: "ai", label: "AI 服务" },
    { id: "fsrs", label: "FSRS 优化" },
    { id: "backup", label: "备份与恢复" },
    { id: "shortcuts", label: "快捷键" }
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel modal-panel-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>设置</h2>
          <button className="icon-btn modal-close" title="关闭" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <div className="settings-layout modal-scroll">
          <nav className="settings-nav">
            {sections.map((s) => (
              <button
                key={s.id}
                className={activeNav === s.id ? "active" : ""}
                onClick={() => {
                  setActiveNav(s.id);
                  document.getElementById(`sec-${s.id}`)?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                {s.label}
              </button>
            ))}
          </nav>

          <div className="settings-content">
            <section className="settings-section" id="sec-appearance">
              <h3>主题模式</h3>
              <div className="seg-tabs">
                <button className={theme === "light" ? "active" : ""} onClick={() => onThemeChange("light")}>
                  浅色
                </button>
                <button className={theme === "dark" ? "active" : ""} onClick={() => onThemeChange("dark")}>
                  深色
                </button>
              </div>
            </section>

            <section className="settings-section" id="sec-skin">
              <h3>皮肤（背景特效）</h3>
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
            </section>

            <section className="settings-section" id="sec-accent">
              <h3>自定义主题颜色（强调色）</h3>
              <div className="settings-row accent-row">
                <input type="color" value={accentColor || "#002fa7"} onChange={(e) => onAccentChange(e.target.value)} />
                <button className="btn btn-secondary btn-sm" onClick={() => onAccentChange("")}>恢复默认</button>
              </div>
            </section>

            <ReaderSection />

            <DashboardSection />

            <LearningDaySection />

            <AISection />

            <FSRSSection />

            <BackupSection />

            <ShortcutsSection />
          </div>
        </div>
      </div>
    </div>
  );
}
