import { useCallback, useEffect, useState, type ReactNode } from "react";
import "./theme.css";
import Bookshelf from "./components/Bookshelf";
import Reader from "./components/Reader";
import QueueView from "./components/QueueView";
import ReviewView from "./components/ReviewView";
import SettingsPanel, { type ThemeMode } from "./components/SettingsPanel";
import { eventBus } from "./lib/eventbus";
import { settingsStore } from "./lib/settings";
import { libraryApi, type DocPayload } from "./lib/library";
import { readingWorkflow } from "./lib/readingWorkflow";
import { getSkin, SKINS } from "./skins";

declare global {
  interface Window {
    windowAPI?: { minimize(): void; maximize(): void; close(): void };
  }
}

type View =
  | { name: "shelf" }
  | { name: "reader"; itemId: string; doc: DocPayload }
  | { name: "queue" }
  | { name: "review" }
  | { name: "extractReader"; extractId: string };

export default function App() {
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [skinId, setSkinId] = useState("none");
  const [accentColor, setAccentColor] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [view, setView] = useState<View>({ name: "shelf" });
  const [extractDetail, setExtractDetail] = useState<Awaited<ReturnType<typeof readingWorkflow.getTopic>>>(null);

  useEffect(() => {
    let settled = false;
    Promise.all([
      settingsStore.get<ThemeMode>("theme", "mode", "light"),
      settingsStore.get<string>("app", "skinId", "none"),
      settingsStore.get<string>("app", "accentColor", "")
    ])
      .then(([m, s, a]) => {
        settled = true;
        setTheme(m === "dark" ? "dark" : "light");
        setSkinId(s);
        setAccentColor(a);
        setLoaded(true);
      })
      .catch((err) => {
        settled = true;
        setLoadError(err instanceof Error ? err.message : String(err));
        setLoaded(true);
      });
    // 8 秒兜底：IPC 若因环境异常挂起，强制进入界面（用默认设置），不再无限白屏
    const timer = window.setTimeout(() => {
      if (!settled) {
        setLoadError("设置读取超时（IPC 无响应），已使用默认设置继续启动。");
        setLoaded(true);
      }
    }, 8000);
    return eventBus.on("theme/changed", (p) => {
      if (p === "light" || p === "dark") setTheme(p);
    }) as unknown as () => void;
  }, []);

  useEffect(() => {
    document.body.classList.remove("theme-light", "theme-dark");
    document.body.classList.add(theme === "dark" ? "theme-dark" : "theme-light");
  }, [theme]);

  useEffect(() => {
    document.body.classList.toggle("has-skin", skinId !== "none");
    document.body.classList.remove(
      ...SKINS.filter((s) => s.bodyClass).map((s) => s.bodyClass as string)
    );
    const bodyClass = getSkin(skinId).bodyClass;
    if (bodyClass) document.body.classList.add(bodyClass);
  }, [skinId]);

  useEffect(() => {
    if (accentColor) {
      document.documentElement.style.setProperty("--interactive-accent", accentColor);
      document.documentElement.style.setProperty("--accent", accentColor);
    } else {
      document.documentElement.style.removeProperty("--interactive-accent");
      document.documentElement.style.removeProperty("--accent");
    }
  }, [accentColor]);

  async function handleThemeChange(m: ThemeMode) {
    setTheme(m);
    await settingsStore.set("theme", "mode", m);
    eventBus.emit("theme/changed", m);
    eventBus.emit("settings/changed", { scope: "theme", key: "mode" });
  }

  async function handleSkinChange(id: string) {
    setSkinId(id);
    await settingsStore.set("app", "skinId", id);
    eventBus.emit("settings/changed", { scope: "app", key: "skinId" });
  }

  async function handleAccentChange(color: string) {
    setAccentColor(color);
    await settingsStore.set("app", "accentColor", color);
    eventBus.emit("settings/changed", { scope: "app", key: "accentColor" });
  }

  const openBook = useCallback((itemId: string) => {
    libraryApi.getDocument(itemId).then((doc) => {
      if (doc) setView({ name: "reader", itemId, doc });
    });
  }, []);

  const backToShelf = useCallback(() => setView({ name: "shelf" }), []);

  const handleExtract = useCallback(
    async (text: string) => {
      if (view.name === "reader") {
        await readingWorkflow.create({
          parentType: "document",
          parentId: view.doc.documentId,
          documentId: view.doc.documentId,
          contentMarkdown: text
        });
      } else if (view.name === "extractReader" && extractDetail) {
        await readingWorkflow.create({
          parentType: "extract",
          parentId: extractDetail.id,
          documentId: extractDetail.documentId,
          contentMarkdown: text
        });
      }
      eventBus.emit("workflow/changed");
    },
    [view, extractDetail]
  );

  const handleDocProgress = useCallback(
    (ratio: number, lastText: string) => {
      if (view.name === "reader") {
        libraryApi.updateProgress(view.itemId, { ratio, lastText, updatedAt: Date.now() });
      }
    },
    [view]
  );

  const openExtract = useCallback((extractId: string) => {
    readingWorkflow.getTopic(extractId).then((detail) => {
      if (detail) {
        setExtractDetail(detail);
        setView({ name: "extractReader", extractId });
      }
    });
  }, []);

  if (!loaded) {
    return (
      <div className="app-loading">
        <div className="loading-brand">
          <span className="brand-mark" />
          <span>渐进阅读 · 正在启动…</span>
        </div>
      </div>
    );
  }

  const skin = getSkin(skinId);
  const SkinComponent = skin.component;

  let mainContent: ReactNode = null;
  let topTitle = "";

  if (view.name === "reader") {
    const p = (() => {
      try {
        const parsed = view.doc.progressJson ? (JSON.parse(view.doc.progressJson) as { ratio?: number }) : null;
        return parsed?.ratio ?? 0;
      } catch {
        return 0;
      }
    })();
    topTitle = view.doc.title;
    mainContent = (
      <Reader
        title={view.doc.title}
        markdown={view.doc.markdown}
        initialRatio={p}
        contextRef={{ documentId: view.doc.documentId }}
        sourceTitle={view.doc.title}
        onBack={backToShelf}
        onProgress={handleDocProgress}
      />
    );
  } else if (view.name === "queue") {
    topTitle = "学习队列";
    mainContent = <QueueView onOpen={openExtract} />;
  } else if (view.name === "review") {
    topTitle = "复习";
    mainContent = <ReviewView />;
  } else if (view.name === "extractReader") {
    topTitle = "摘录";
    mainContent = extractDetail ? (
      <Reader
        title="摘录"
        markdown={extractDetail.contentMarkdown}
        contextLabel={
          `来自《${extractDetail.docTitle}》` +
          (extractDetail.depth > 1 ? ` · 第${extractDetail.depth}层摘录` : "")
        }
        contextRef={{ documentId: extractDetail.documentId, extractId: extractDetail.id }}
        sourceTitle={extractDetail.docTitle}
        onBack={() => setView({ name: "queue" })}
      />
    ) : null;
  } else {
    mainContent = <Bookshelf onOpenBook={openBook} />;
  }

  return (
    <div className="app-shell">
      {loadError && (
        <div className="startup-warning">
          <span>{loadError}</span>
          <button onClick={() => setLoadError(null)}>知道了</button>
        </div>
      )}
      {skinId !== "none" && (
        <div className="skin-layer">
          <SkinComponent {...skin.props} />
        </div>
      )}
      <header className="topbar">
        {view.name !== "shelf" ? (
          <>
            <button
              className="icon-btn"
              title="返回"
              onClick={view.name === "extractReader" ? () => setView({ name: "queue" }) : backToShelf}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m12 19-7-7 7-7" />
                <path d="M19 12H5" />
              </svg>
            </button>
            <span className="topbar-title">{topTitle}</span>
          </>
        ) : (
          <div className="brand">
            <span className="brand-mark" />
            <span className="brand-name">渐进阅读</span>
            <span className="brand-sub">INCREMENTAL READING</span>
          </div>
        )}
        <div className="topbar-right">
          <button
            className={`icon-btn${view.name === "review" ? " icon-btn-active" : ""}`}
            title="复习"
            onClick={() => setView(view.name === "review" ? { name: "shelf" } : { name: "review" })}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z" />
              <path d="M22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z" />
            </svg>
          </button>
          <button
            className={`icon-btn${view.name === "queue" || view.name === "extractReader" ? " icon-btn-active" : ""}`}
            title="学习队列"
            onClick={() => setView(view.name === "queue" ? { name: "shelf" } : { name: "queue" })}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="8" y1="6" x2="21" y2="6" />
              <line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" />
              <line x1="3" y1="12" x2="3.01" y2="12" />
              <line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
          </button>
          <button className="icon-btn" title="设置" onClick={() => setSettingsOpen(true)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          <div className="win-controls">
            <button className="icon-btn" title="最小化" onClick={() => window.windowAPI?.minimize()}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M5 12h14" />
              </svg>
            </button>
            <button className="icon-btn" title="最大化/还原" onClick={() => window.windowAPI?.maximize()}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="5" y="5" width="14" height="14" />
              </svg>
            </button>
            <button className="icon-btn win-close" title="关闭" onClick={() => window.windowAPI?.close()}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          </div>
        </div>
      </header>
      {mainContent}
      {settingsOpen && (
        <SettingsPanel
          theme={theme}
          onThemeChange={handleThemeChange}
          skinId={skinId}
          onSkinChange={handleSkinChange}
          accentColor={accentColor}
          onAccentChange={handleAccentChange}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
