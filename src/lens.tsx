// 独立结构图窗口入口（v49.24 / D197，设计 docs/design/MINDMAP-V2-IMPL-PLAN.md §14）。
// 阅读透镜 v2 的面板从主窗口内的浮层 / 正文下方搬进独立窗口：面板本身（MindmapLens）一字不改地复用，
// 只把「内核」换成经 preload 桥代理到阅读窗口的 LensKernel（src/lib/lensBridge.ts）。
// 窗口纪律与独立制卡台窗口同构：无边框自绘 + 默认置顶（可在窗口内切换）+ 关闭＝隐藏 + 每次呼出重读外观。
// 主题 / 皮肤跟随主应用（同一套 theme.css；C-31 起换肤 / 动效 / 强调色由主进程 settings:changed 广播
// 经 <WindowSkin /> 即时同步——SkinHost 独立窗口挂载点，呼出时另经 applyCaptureAppearance 重读兜底）。
import "./lib/cspReport";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import MindmapLens from "./components/reader/MindmapLens";
import { applyCaptureAppearance } from "./components/CaptureEditor";
import { WindowSkin } from "./skins/WindowSkin";
import { createLensKernel } from "./lib/lensBridge";
import { installThemePluginBridge } from "./lib/themePlugins";
import { installMindmapBridge } from "./lib/mindmap";
import { loadLocale, useT } from "./lib/i18n";
import { settingsStore } from "./lib/settings";
import "./styles/layers.css"; // v49.0 / D170：层序预注册，先于 theme.css
import "./theme.css";

/** 单例：StrictMode 下渲染函数会跑两遍，桥只能在模块级建一次（否则订阅重复） */
const bridge = createLensKernel();

function LensWindow() {
  const T = useT();
  const [ctx, setCtx] = useState<{ documentId: string | null; title: string }>({ documentId: null, title: "" });
  const [pinned, setPinned] = useState(true);
  /** 窗口是否可见（D199：关闭＝隐藏，面板仍挂载 → 需把「不在场」传达给面板，收回正文强调） */
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const offPush = window.lensAPI?.onPush((payload) => {
      bridge.applyPush(payload);
      // 「阅读位置」推送由内核代理直接分发给面板；只有上下文变化需要触发本层重渲染
      if (payload?.kind === "context") {
        setCtx({ documentId: payload.payload.documentId ?? null, title: payload.payload.title ?? "" });
      }
    });
    const offWin = window.lensAPI?.onWindow((s) => {
      setPinned(!!s?.pinned);
      setVisible(!!s?.visible);
      void applyCaptureAppearance(); // 长生命周期单例：每次呼出重读主题 / 强调色（与制卡台同规）
      if (s?.visible) bridge.requestRefresh(); // 窗口（重新）呼出：请阅读窗口补推上下文与阅读位置
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) window.lensAPI?.control("hide");
    };
    window.addEventListener("keydown", onKey);
    bridge.requestRefresh();
    return () => {
      offPush?.();
      offWin?.();
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className="lens-root">
      {/* C-31：独立窗口外观挂载点——皮肤 CSS / html[data-skin] / 动效三态与主窗口同步（settings:changed） */}
      <WindowSkin />
      <MindmapLens
        kernel={bridge.kernel}
        documentId={ctx.documentId}
        title={ctx.title || T("未命名材料")}
        open
        hidden={false}
        onClose={() => void window.lensAPI?.control("hide")}
        onOpenInMap={(nodeId, region) => window.lensAPI?.ask({ kind: "openInMap", payload: { nodeId, region } })}
        visible={visible}
        pinned={pinned}
        onPin={() => void window.lensAPI?.control("pin").then((s) => setPinned(!!s?.pinned))}
        fit={window.lensAPI?.fit}
      />
    </div>
  );
}

installThemePluginBridge(); // 主题插件跟随（与主窗口 / 制卡台同一条注入链）
installMindmapBridge(); // 主进程 mindmap:delta / mindmap:changed → EventBus（画布增量与版本切换同源）
void applyCaptureAppearance()
  .then(() => settingsStore.get<string>("app", "language", "zh-CN"))
  .then((lang) => loadLocale(lang)) // 首绘前装载界面语言（D237：词典/转换器按需装载，就绪后再首绘），零闪烁
  .then(() => {
    createRoot(document.getElementById("root")!).render(
      <React.StrictMode>
        <LensWindow />
      </React.StrictMode>
    );
  });
