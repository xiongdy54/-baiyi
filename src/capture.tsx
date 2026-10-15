// 快速记录窗口入口（v36，M8-A，§5.4 / §6.5.2）
// 独立窗口（560×380 无框置顶）：主题跟随主应用 → 渲染编辑器 → 通知主进程「就绪」后才 show（防白闪）。
import React from "react";
import { createRoot } from "react-dom/client";
import CaptureEditor, { applyCaptureAppearance } from "./components/CaptureEditor";
// v48.89（D132 §6.4）：捕获窗跟随主题插件（最小子集桥：getActive/onChanged）
import { installThemePluginBridge } from "./lib/themePlugins";
import "./styles/layers.css"; // v49.0 / D170：层序预注册，先于 theme.css
import "./theme.css";

declare global {
  interface Window {
    captureAPI?: {
      ready(): void;
      hide(): Promise<boolean>;
      onShown(callback: () => void): () => void;
      day(date?: string): Promise<{
        date: string;
        count: number;
        entries: unknown[];
        draft: import("./lib/journal").JournalEntry | null;
      }>;
      draft(): Promise<import("./lib/journal").JournalEntry | null>;
      draftSave(contentMarkdown: string): Promise<{ ok: boolean; entry: import("./lib/journal").JournalEntry | null }>;
      draftSend(contentMarkdown: string): Promise<{ ok: boolean; entry: import("./lib/journal").JournalEntry }>;
      discardDraft(id: string): Promise<boolean>;
    };
  }
}

try {
  installThemePluginBridge(); // v48.89（D132）：主题插件跟随（桥内自带 try/catch，失败仅告警回落）
  void applyCaptureAppearance().then(() => {
    createRoot(document.getElementById("root")!).render(
      <React.StrictMode>
        <CaptureEditor />
      </React.StrictMode>
    );
  });
} catch (err) {
  document.body.textContent = `快速记录启动失败：${err instanceof Error ? err.message : String(err)}`;
  window.captureAPI?.ready();
}
