import { useEffect, useRef, useState } from "react";
import { SKINS } from "../skins";
import { aiGateway, type AIConfig } from "../lib/ai";
import { settingsStore } from "../lib/settings";
import { WIDGETS } from "./dashboard/widgets";
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

// FSRS 参数优化（v12）：从复习记录训练个性化权重（fsrs-rs-nodejs），应用后调度即刻生效
function FSRSSection() {
  const [stats, setStats] = useState<{ reviewCount: number; cardCount: number; minRecommended: number; enough: boolean } | null>(null);
  const [appliedW, setAppliedW] = useState<number[] | null>(null);
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
    (window as unknown as { optimizerAPI?: { current: () => Promise<number[] | null> } }).optimizerAPI
      ?.current()
      .then(setAppliedW)
      .catch(() => setAppliedW(null));
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
    const api = (window as unknown as { optimizerAPI?: { apply: (w: number[]) => Promise<boolean> } }).optimizerAPI!;
    await api.apply(trainedW);
    setAppliedW(trainedW);
    setTrainedW(null);
    setNotice({ ok: true, text: "已应用优化权重，复习调度即刻使用新参数。" });
  }

  async function handleReset() {
    const api = (window as unknown as { optimizerAPI?: { reset: () => Promise<boolean> } }).optimizerAPI!;
    await api.reset();
    setAppliedW(null);
    setNotice({ ok: true, text: "已恢复 FSRS 默认参数。" });
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
      <p className="form-hint">当前参数：{appliedW ? "优化权重" : "默认参数"}</p>

      <div className="settings-row" style={{ flexWrap: "wrap" }}>
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={handleTrain}>
          {busy ? `训练中… ${progress !== null ? progress + "%" : ""}` : "开始优化"}
        </button>
        {trainedW && (
          <button className="btn btn-secondary btn-sm" onClick={handleApply}>
            应用优化结果
          </button>
        )}
        {appliedW && (
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
    { id: "dashboard", label: "统计仪表盘" },
    { id: "ai", label: "AI 服务" },
    { id: "fsrs", label: "FSRS 优化" }
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

            <DashboardSection />

            <AISection />

            <FSRSSection />
          </div>
        </div>
      </div>
    </div>
  );
}
