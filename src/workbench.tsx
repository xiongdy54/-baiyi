// 独立制卡台窗口入口（v48.79 / D123）：全局快捷键 / 托盘菜单呼出的单例窗口。
// 与主窗口共用同一套制卡台组件（手动制卡 / AI 制卡 / AI 解释，自由模式：无来源锚，粘贴文字做 AI 处理）；
// 主题跟随主应用——单例窗口只隐藏不销毁，所以每次呼出（win:workbenchShown）都重读外观。
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import FreeWorkbenchHost from "./components/FreeWorkbenchHost";
import { applyCaptureAppearance } from "./components/CaptureEditor";
import { eventBus } from "./lib/eventbus";
import "./theme.css";

function WorkbenchWindow() {
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
      <header className="wbw-bar">
        <span className="wbw-title">制卡台</span>
        <button
          type="button"
          className={`wbw-btn${pinned ? " on" : ""}`}
          aria-pressed={pinned}
          title="窗口置顶"
          onClick={() => void window.windowAPI?.workbench?.("pin").then((s) => setPinned(s.pinned))}
        >
          置顶
        </button>
        <button type="button" className="wbw-btn" title="收起窗口（Esc；软件仍在托盘运行）" onClick={() => window.windowAPI?.close()}>
          关闭
        </button>
      </header>
      <div className="wbw-body">
        <FreeWorkbenchHost standalone />
      </div>
    </div>
  );
}

void applyCaptureAppearance().then(() => {
  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <WorkbenchWindow />
    </React.StrictMode>
  );
});
