// 统计数据页（v2 简化布局）：组件有序列表，wide/half 两种尺寸，拖拽=列表位置交换
// 数据：stats:overview 一次拉取；eventbus 刷新；布局/可见性/图型选择全部走 settings(scope=dashboard)
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { statsApi, type StatsOverview } from "../../lib/stats";
import { settingsStore } from "../../lib/settings";
import { eventBus } from "../../lib/eventbus";
import { WIDGETS, widgetById, normalizeChartId, rnd, type WidgetDef } from "./widgets";
import Dropdown from "../Dropdown";
import {
  defaultLayoutV2, isSaneLayoutV2, toRows, reorder, syncHidden,
  type DashLayoutV2, type WidgetSize
} from "./layout";
import { IconGrip } from "../icons";

interface WidgetConfig {
  dataKey: string;
  chart: string;
}

export default function Dashboard() {
  const [overview, setOverview] = useState<StatsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [layout, setLayout] = useState<DashLayoutV2 | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [configs, setConfigs] = useState<Record<string, WidgetConfig>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [paletteTick, setPaletteTick] = useState(0);

  // 初始加载
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [hiddenS, configsS, layoutS] = await Promise.all([
          settingsStore.get<string[]>("dashboard", "hiddenWidgets", []),
          settingsStore.get<Record<string, WidgetConfig>>("dashboard", "configs", {}),
          settingsStore.get<DashLayoutV2 | null>("dashboard", "layout", null)
        ]);
        if (!alive) return;
        setHidden(hiddenS);
        setConfigs(configsS);
        setLayout(syncHidden(isSaneLayoutV2(layoutS) ? layoutS! : defaultLayoutV2(hiddenS), hiddenS));
        const o = await statsApi.overview();
        if (!alive) return;
        if (o) setOverview(o);
        else setError("统计服务不可用（statsAPI 未注入）");
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => { alive = false; };
  }, []);

  // 数据刷新 + 主题切换重绘
  useEffect(() => {
    const refresh = () => { statsApi.overview().then((o) => { if (o) setOverview(o); }); };
    const off1 = eventBus.on("cards/changed", refresh);
    const off2 = eventBus.on("library/changed", refresh);
    const off3 = eventBus.on("workflow/changed", refresh);
    const off4 = eventBus.on("theme/changed", () => { setPaletteTick((t) => t + 1); refresh(); });
    return () => { off1(); off2(); off3(); off4(); };
  }, []);

  const persistLayout = useCallback((next: DashLayoutV2) => {
    settingsStore.set("dashboard", "layout", next);
  }, []);

  const handleMove = useCallback((sourceId: string, targetId: string) => {
    setLayout((prev) => {
      if (!prev) return prev;
      const next = reorder(prev, sourceId, targetId);
      persistLayout(next);
      return next;
    });
  }, [persistLayout]);

  const onLeafDragOver = useCallback((widgetId: string) => (e: React.DragEvent) => {
    if (!dragId || dragId === widgetId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTargetId((prev) => (prev === widgetId ? prev : widgetId));
  }, [dragId]);

  const onLeafDrop = useCallback((widgetId: string) => (e: React.DragEvent) => {
    e.preventDefault();
    const source = dragId || e.dataTransfer.getData("text/widget-id");
    if (source && source !== widgetId) handleMove(source, widgetId);
    setDragId(null);
    setDropTargetId(null);
  }, [dragId, handleMove]);

  const getConfig = useCallback((w: WidgetDef): WidgetConfig => {
    const raw = configs[w.id] || { dataKey: w.defaultData, chart: w.defaultChart };
    // 存量配置里的旧 chart id 归一化为新图型 id（渲染与下拉显示一致）
    return { dataKey: raw.dataKey, chart: normalizeChartId(w.id, raw.chart) };
  }, [configs]);

  const setConfig = useCallback((widgetId: string, patch: Partial<WidgetConfig>) => {
    setConfigs((prev) => {
      const next = { ...prev, [widgetId]: { ...(prev[widgetId] || { dataKey: widgetById(widgetId)!.defaultData, chart: widgetById(widgetId)!.defaultChart }), ...patch } };
      settingsStore.set("dashboard", "configs", next);
      return next;
    });
  }, []);

  // 设置面板开关组件/改宽度后同步（settingsStore.set 会发 settings/changed）
  useEffect(() => {
    return eventBus.on("settings/changed", async (payload?: unknown) => {
      const scope = (payload as { scope?: string; key?: string } | undefined)?.scope;
      if (scope && scope !== "dashboard") return;
      const [hiddenS, layoutS] = await Promise.all([
        settingsStore.get<string[]>("dashboard", "hiddenWidgets", []),
        settingsStore.get<DashLayoutV2 | null>("dashboard", "layout", null)
      ]);
      setHidden(hiddenS);
      setLayout((prev) => {
        const merged = syncHidden(prev || defaultLayoutV2(hiddenS), hiddenS);
        // 设置页只改 sizes 时（layoutS 带 sizes），以设置页为准
        if (layoutS && layoutS.sizes) return { ...merged, sizes: { ...merged.sizes, ...layoutS.sizes } };
        return merged;
      });
    });
  }, []);

  const renderWidget = useCallback((widgetId: string) => {
    const def = widgetById(widgetId);
    if (!def || !overview) return null;
    const cfg = getConfig(def);
    const size = layout?.sizes[widgetId] === "half" ? "half" : "wide";
    const chartOptions = [...new Map(def.dataKeys.flatMap((dk) => (def.charts[dk] || []).map((c) => [c.id, { value: c.id, label: c.label, dk }]))).values()];
    const dataOptions = def.dataKeys.map((dk) => ({
      value: dk,
      label: def.dataLabels?.[dk] ?? (dk === "domains-main" ? "按主类" : dk === "domains-detail" ? "按二级" : dk === "duration-hist" ? "时长分布" : dk === "duration-by-field" ? "按领域" : dk)
    }));
    return (
      <div
        key={widgetId}
        className={`dash-widget card-fill dash-widget-${size}`}
        data-widget={widgetId}
        data-dragging={dragId === widgetId || undefined}
        data-drop={dropTargetId === widgetId || undefined}
        onDragOver={onLeafDragOver(widgetId)}
        onDrop={onLeafDrop(widgetId)}
      >
        <div
          className="dash-widget-head"
          draggable
          onDragStart={(e) => { e.dataTransfer.setData("text/widget-id", widgetId); e.dataTransfer.effectAllowed = "move"; setDragId(widgetId); }}
          onDragEnd={() => { setDragId(null); setDropTargetId(null); }}
        >
          <IconGrip size={16} className="dash-grip" title="拖动排列" />
          <span className="dash-widget-title">{def.title}</span>
          <div className="dash-widget-tools" onClick={(e) => e.stopPropagation()}>
            {chartOptions.length > 1 && (
              <Dropdown
                title="切换图型"
                value={cfg.chart}
                options={chartOptions}
                onChange={(chartId) => {
                  // 当前数据档支持该图型就保留档位；否则落到第一个支持的档位
                  const offers = (k: string) => (def.charts[k] || []).some((c) => c.id === chartId);
                  const dk = offers(cfg.dataKey) ? cfg.dataKey : (def.dataKeys.find(offers) || cfg.dataKey);
                  setConfig(widgetId, { chart: chartId, dataKey: dk });
                }}
              />
            )}
            {dataOptions.length > 1 && (
              <Dropdown
                title="选择数据"
                value={cfg.dataKey}
                options={dataOptions}
                onChange={(dk) => {
                  const cs = def.charts[dk] || [];
                  setConfig(widgetId, { dataKey: dk, chart: cs.some((c) => c.id === cfg.chart) ? cfg.chart : (cs[0]?.id || cfg.chart) });
                }}
              />
            )}
          </div>
        </div>
        <div className="dash-widget-body">
          {def.render(overview, cfg.dataKey, cfg.chart, rnd)}
        </div>
      </div>
    );
  }, [overview, getConfig, setConfig, dragId, dropTargetId, onLeafDragOver, onLeafDrop, layout]);

  // 可见组件行分解（Hooks 规则：useMemo 在条件 return 之前）
  const rows = useMemo(() => {
    if (!layout) return [];
    return toRows(layout);
  }, [layout]);

  if (error) {
    return (
      <section className="dashboard dash-page">
        <div className="empty-state">
          <div className="empty-deco"><span className="empty-sq empty-sq-accent" /><span className="empty-sq" /><span className="empty-sq" /></div>
          <p className="empty-text">{error}</p>
        </div>
      </section>
    );
  }

  if (!overview || !layout) {
    return (
      <section className="dashboard dash-page">
        <div className="dash-skeleton">
          <div className="skeleton skeleton-kpi" />
          <div className="skeleton skeleton-chart" />
        </div>
      </section>
    );
  }

  return (
    <section className="dashboard dash-page" data-palette-tick={paletteTick}>
      <div className="dash-grid">
        {rows.map((row, i) => {
          if (row.kind === "pair") {
            return (
              <div className="dash-row" key={`r${i}`}>
                {row.ids.map((id) => renderWidget(id))}
              </div>
            );
          }
          return renderWidget(row.id);
        })}
      </div>
    </section>
  );
}
