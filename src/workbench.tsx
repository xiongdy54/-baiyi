// 独立制卡台窗口入口（v48.79 / D123）：全局快捷键 / 托盘菜单呼出的单例窗口。
// 与主窗口共用同一套制卡台组件（手动制卡 / AI 制卡 / AI 解释，自由模式：无来源锚，粘贴文字做 AI 处理）；
// 主题跟随主应用——单例窗口只隐藏不销毁，所以每次呼出（win:workbenchShown）都重读外观。
// v49.8（D182）：界面语言跟随主应用——首绘前经 settingsAPI 读 app.language（localStorage 缓存兜底零闪烁）。
import "./lib/cspReport";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import FreeWorkbenchHost from "./components/FreeWorkbenchHost";
import { applyCaptureAppearance } from "./components/CaptureEditor";
import { WindowSkin } from "./skins/WindowSkin"; // C-31：独立窗口外观挂载点（settings:changed 即时同步换肤 / 动效 / 强调色）
// v48.89（D132 §6.4）：制卡台窗口跟随主题插件（主 preload 全量桥，随 preload.js 注入）
import { installThemePluginBridge } from "./lib/themePlugins";
import { eventBus } from "./lib/eventbus";
import { loadLocale, useT } from "./lib/i18n";
import { settingsStore } from "./lib/settings";
import "./styles/layers.css"; // v49.0 / D170：层序预注册，先于 theme.css
import "./theme.css";

function WorkbenchWindow() {
  const T = useT();
  const [pinned, setPinned] = useState(true);
  useEffect(() => {
    // 建卡后转告主窗口（两个渲染进程的 eventBus 互不相通）
    const offCards = eventBus.on("cards/changed", () => window.windowAPI?.notifyCardsChanged?.());
    const offShown = window.windowAPI?.onWorkbenchShown?.(() => void applyCaptureAppearance());
    // Esc＝收起窗口（已被下拉菜单等消费的 Esc 不处理）；软件仍在托盘运行，草稿保留
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) window.windowAPI?.close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      offCards();
      offShown?.();
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  return (
    <div className="wbw">
      {/* C-31：独立窗口外观挂载点——皮肤 CSS / html[data-skin] / 动效三态与主窗口同步 */}
      <WindowSkin />
      <header className="wbw-bar">
        <span className="wbw-title">{T("制卡台")}</span>
        <button
          type="button"
          className={`wbw-btn${pinned ? " on" : ""}`}
          aria-pressed={pinned}
          title={T("窗口置顶")}
          onClick={() => void window.windowAPI?.workbench?.("pin").then((s) => setPinned(s.pinned))}
        >
          {T("置顶")}
        </button>
        <button type="button" className="wbw-btn" title={T("收起窗口（Esc；软件仍在托盘运行）")} onClick={() => window.windowAPI?.close()}>
          {T("关闭")}
        </button>
      </header>
      <div className="wbw-body">
        <FreeWorkbenchHost standalone />
      </div>
    </div>
  );
}

installThemePluginBridge(); // v48.89（D132）：主题插件跟随（与 applyCaptureAppearance 同期首拉）
void applyCaptureAppearance()
  .then(() => settingsStore.get<string>("app", "language", "zh-CN"))
  .then((lang) => loadLocale(lang)) // v49.8（D182）：首绘前装载界面语言（D237：资源按需装载，就绪后再首绘）
  .then(() => {
    createRoot(document.getElementById("root")!).render(
      <React.StrictMode>
        <WorkbenchWindow />
      </React.StrictMode>
    );
  });
