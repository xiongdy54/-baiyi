import { useCallback, useEffect, useState, type ReactNode } from "react";
import "./theme.css";
import Bookshelf from "./components/Bookshelf";
import Reader from "./components/Reader";
import QueueView from "./components/QueueView";
import ReviewView from "./components/ReviewView";
import CardBrowser from "./components/CardBrowser";
import JournalView from "./components/JournalView";
import AddBookModal from "./components/AddBookModal";
import SettingsPanel, { type ThemeMode } from "./components/SettingsPanel";
import Dashboard from "./components/dashboard/Dashboard";
import { eventBus } from "./lib/eventbus";
import { settingsStore } from "./lib/settings";
import { commandRegistry } from "./lib/commands";
import { libraryApi, type DocPayload } from "./lib/library";
import { installJournalBridge, shortcutsApi } from "./lib/journal";
import { installInsightBridge } from "./lib/insight";
import { installMemoryBridge } from "./lib/memory";
import { installMindmapBridge } from "./lib/mindmap";
import { installActivityStore } from "./lib/activity";
import { BackgroundActivity } from "./components/BackgroundActivity";
import { readingWorkflow } from "./lib/readingWorkflow";
import { buildSyntheticEpub, mediaTypeForFilename, type SynthImage } from "./lib/epub";
import { getSkin, SKINS } from "./skins";

declare global {
  interface Window {
    windowAPI?: { minimize(): void; maximize(): void; close(): void; openExternal(url: string): Promise<boolean> };
  }
}

type View =
  | { name: "shelf" }
  | {
      name: "reader";
      itemId: string;
      doc: DocPayload;
      /** 原书文件字节（存在即走阅读内核；engine=pdf 时走 pdf.js 内核直读） */
      book?: { bytes: Uint8Array; name: string; engine?: "foliate" | "pdf" };
      jumpAnchor?: { anchorText: string; anchorRatio?: number; cfi?: string; chapterIndex?: number; pageIndex?: number; imageAnchor?: { alt?: string; contextText?: string }; occlusion?: { rects: { x: number; y: number; w: number; h: number; ord: number }[]; shapes?: unknown; regionScope?: string; cardOrd?: number; assetPath?: string } };
      returnTo?: "review" | "queue" | "browse";
      /** v48.13（P2）：从右下角指示器「打开导图」进入时置位——Reader 挂载后自动打开导图工作区 */
      openMindmap?: boolean;
      /** v48.13（P2）：要展示的导图版本（候选版本——按发布模型不激活，但用户点了就该看到它） */
      openMindmapMapId?: string | null;
    }
  | { name: "queue" }
  | { name: "review" }
  | { name: "browse" }
  | { name: "journal" }
  | { name: "stats" }
  | { name: "extractReader"; extractId: string; book?: { bytes: Uint8Array; name: string } };

export default function App() {
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [skinId, setSkinId] = useState("none");
  const [accentColor, setAccentColor] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // v36（M8-A）：添加材料模态提升到 App 级——全局快捷键 Ctrl+Alt+N 与书架入口共用同一模态，
  // 且快捷键呼出时**不切换视图**（阅读位置与复习会话原地保留，D34-⑤）
  const [addMaterialOpen, setAddMaterialOpen] = useState(false);
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

  // M4：CommandRegistry 全局键位分发（§4.2-2 落地）——读覆盖键位 + 装 keydown 监听
  useEffect(() => {
    void commandRegistry.init();
    commandRegistry.install();
  }, []);

  // v36（M8-A）：日记事件桥（主进程写入推送 → EventBus）+ 全局快捷键「添加学习材料」的就地弹模态
  // v40（M8-B）：洞察事件桥（主进程洞察运行/反馈推送 → EventBus）
  // v45（M14-UM1）：记忆事件桥（主进程整理/补处理进度推送 → 设置页记忆区）
  useEffect(() => {
    installJournalBridge();
    installInsightBridge();
    installMemoryBridge();
    installMindmapBridge(); // v48.9：导图生成进度桥（批3 遗漏——进度曾永远停在初始值）
    // v48.13（P2）：导图广播 → 全局活动状态（右下角指示器的唯一数据源；与所在界面无关）
    installActivityStore();
    return shortcutsApi.onOpenAddMaterial(() => setAddMaterialOpen(true));
  }, []);

  // M4：设置弹窗打开期间抑制全局快捷键（弹窗无输入焦点时按键不得触发其下层的复习/阅读动作）
  useEffect(() => {
    if (settingsOpen) commandRegistry.pushSuppress("settings-modal");
    else commandRegistry.popSuppress("settings-modal");
    return () => commandRegistry.popSuppress("settings-modal");
  }, [settingsOpen]);

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

  // 阅读内核分流（v20 一切皆书）：文件书读原书字节；粘贴书惰性确定性合成 EPUB（同 generatorVersion 结构恒同，CFI 稳定）
  // M6-1（v26）：Word/TXT/Markdown 走同一 synth 分支；Word 内嵌图从 assets 取回字节随包内嵌（syn-2 图片能力）
  // M6-2 修订（v28 PDF 原生阅读）：PDF 走 pdf.js 内核直读原文件（engine:"pdf"），不再合成
  const loadReaderBook = useCallback(async (itemId: string, doc: DocPayload): Promise<{ bytes: Uint8Array; name: string; engine?: "foliate" | "pdf" } | undefined> => {
    if (doc.sourceType === "epub") {
      const bytes = await libraryApi.readBookFile(itemId);
      return bytes ? { bytes, name: "original.epub" } : undefined;
    }
    if (doc.sourceType === "pdf") {
      const bytes = await libraryApi.readPdfFile(itemId);
      return bytes ? { bytes, name: "original.pdf", engine: "pdf" as const } : undefined;
    }
    // M6-3（v30）：被动兼容电子书（MOBI/AZW3/FB2/CBZ）——原文件 + 原文件名（foliate 按魔数/扩展名分发）
    if (doc.sourceType === "ebook") {
      const file = await libraryApi.readEbookFile(itemId);
      return file && file.bytes.length ? { bytes: file.bytes, name: file.name } : undefined;
    }
    let images: SynthImage[] | undefined;
    if (doc.sourceType === "word") {
      const contentImages = await libraryApi.readContentImages(itemId);
      if (contentImages.length) {
        images = contentImages.map((im) => ({
          filename: im.filename,
          bytes: im.bytes,
          mediaType: mediaTypeForFilename(im.filename)
        }));
      }
    }
    const syn = await buildSyntheticEpub(doc.title, doc.markdown, { images });
    return { bytes: syn.bytes, name: "synthetic.epub" };
  }, []);

  const openBook = useCallback((itemId: string) => {
    libraryApi.getDocument(itemId).then(async (doc) => {
      if (!doc) return;
      const book = await loadReaderBook(itemId, doc);
      setView({ name: "reader", itemId, doc, book });
    });
  }, [loadReaderBook]);

  const backToShelf = useCallback(() => setView({ name: "shelf" }), []);

  // v48.13（P2）：右下角指示器「打开导图」——已在读该材料则就地打开工作区，
  // 否则先按 documentId 找回书架条目、载入内核，再带 openMindmap 标记进入（Reader 挂载后自动打开）。
  const openMaterialMap = useCallback(
    async (documentId: string, mapId?: string | null) => {
      if (view.name === "reader" && view.doc.documentId === documentId) {
        setView({ ...view, openMindmap: true, openMindmapMapId: mapId ?? null });
        return;
      }
      const itemId = await libraryApi.getItemIdByDocumentId(documentId);
      if (!itemId) return;
      const doc = await libraryApi.getDocument(itemId);
      if (!doc) return;
      const book = await loadReaderBook(itemId, doc);
      setView({ name: "reader", itemId, doc, book, openMindmap: true, openMindmapMapId: mapId ?? null });
    },
    [view, loadReaderBook]
  );

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
    (ratio: number, lastText: string, extra?: { cfi?: string; fraction?: number }) => {
      if (view.name === "reader") {
        libraryApi.updateProgress(view.itemId, { ratio, lastText, updatedAt: Date.now(), ...extra });
      }
    },
    [view]
  );

  const openExtract = useCallback((extractId: string) => {
    readingWorkflow.getTopic(extractId).then(async (detail) => {
      if (!detail) return;
      // 摘录统一进阅读内核（v20）：内容合成为单章 EPUB；阅读进度/统计不落库（摘录非书）
      const syn = await buildSyntheticEpub("摘录", detail.contentMarkdown, { embedKatexCss: false });
      setExtractDetail(detail);
      setView({ name: "extractReader", extractId, book: { bytes: syn.bytes, name: "synthetic.epub" } });
    });
  }, []);

  // 「跳转原文」（复习卡 / 队列摘录 / 卡片浏览 共用）：documentId 反查书架条目，以锚点打开阅读器，
  // 返回按钮回到来源页。跳转属「现场查看」语义（v19）：本次阅读器会话不落阅读进度与阅读字数，
  // 切出后软件记录的位置仍是上次真实阅读的位置，不会被跳转位置覆盖。
  const handleJumpToDoc = useCallback(async (
    docId: string,
    anchor: NonNullable<Extract<View, { name: "reader" }>["jumpAnchor"]>,
    returnTo: "review" | "queue" | "browse" = "review"
  ) => {
    if (returnTo === "review") {
      // 仅复习来源需要现场恢复标记（返回时恢复该卡与翻面状态）
      try {
        sessionStorage.setItem("reviewSession", JSON.stringify({ resume: true }));
      } catch { /* sessionStorage 不可用时跳转仍生效，只是不恢复现场 */ }
    }
    const itemId = await libraryApi.getItemIdByDocumentId(docId);
    if (!itemId) return;
    const doc = await libraryApi.getDocument(itemId);
    if (doc) {
      const book = await loadReaderBook(itemId, doc);
      setView({ name: "reader", itemId, doc, book, jumpAnchor: anchor, returnTo });
    }
  }, [loadReaderBook]);

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
    const progressCfi = (() => {
      try {
        const parsed = view.doc.progressJson ? (JSON.parse(view.doc.progressJson) as { cfi?: string }) : null;
        return typeof parsed?.cfi === "string" ? parsed.cfi : null;
      } catch {
        return null;
      }
    })();
    // v28 PDF 原生阅读：progress 页码锚点（0 基）；foliate 系走 cfi
    const progressPageIndex = (() => {
      try {
        const parsed = view.doc.progressJson ? (JSON.parse(view.doc.progressJson) as { pageIndex?: number }) : null;
        return typeof parsed?.pageIndex === "number" ? parsed.pageIndex : null;
      } catch {
        return null;
      }
    })();
    topTitle = view.doc.title;
    mainContent = (
      <Reader
        title={view.doc.title}
        markdown={view.doc.markdown}
        itemId={view.itemId}
        initialRatio={p}
        initialCfi={progressCfi}
        initialPageIndex={progressPageIndex}
        book={view.book}
        contextRef={{ documentId: view.doc.documentId }}
        jumpAnchor={view.jumpAnchor}
        sourceTitle={view.doc.title}
        onBack={view.jumpAnchor ? () => setView({ name: view.returnTo ?? "review" } as View) : backToShelf}
        onSwitchAppTheme={handleThemeChange}
        // 跳转进入（jumpAnchor 存在）时不传 onProgress：Reader 的滚动/卸载保存全部失效，
        // 阅读进度与阅读字数保持上次真实阅读的值（v19 现场查看语义）
        onProgress={view.jumpAnchor ? undefined : handleDocProgress}
        openMindmapInitially={Boolean(view.openMindmap)}
        openMindmapMapId={view.openMindmapMapId ?? null}
        onMindmapOpened={() => setView((v) => (v.name === "reader" ? { ...v, openMindmap: false } : v))}
      />
    );
  } else if (view.name === "queue") {
    topTitle = "学习队列";
    mainContent = <QueueView onOpen={openExtract} onJumpToDoc={handleJumpToDoc} />;
  } else if (view.name === "review") {
    topTitle = "复习";
    mainContent = <ReviewView onJumpToDoc={handleJumpToDoc} />;
  } else if (view.name === "browse") {
    topTitle = "卡片浏览";
    mainContent = <CardBrowser onJumpToDoc={handleJumpToDoc} />;
  } else if (view.name === "journal") {
    topTitle = "日记";
    mainContent = <JournalView onJumpToDoc={handleJumpToDoc} />;
  } else if (view.name === "stats") {
    topTitle = "统计数据";
    mainContent = <Dashboard />;
  } else if (view.name === "extractReader") {
    topTitle = "摘录";
    mainContent = extractDetail ? (
      <Reader
        title="摘录"
        markdown={extractDetail.contentMarkdown}
        book={view.book}
        itemId={extractDetail.documentId}
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
    mainContent = <Bookshelf onOpenBook={openBook} onAddMaterial={() => setAddMaterialOpen(true)} />;
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
        {/* 文字主导航（v12.1）：常驻左侧，当前项 accent 高亮；书架视图不再渲染品牌字块 */}
        <nav className="topbar-nav">
          {([
            { key: "shelf", label: "书架", match: (n: string) => n === "shelf" },
            { key: "queue", label: "队列", match: (n: string) => n === "queue" || n === "extractReader" },
            { key: "review", label: "复习", match: (n: string) => n === "review" },
            { key: "browse", label: "卡片", match: (n: string) => n === "browse" },
            { key: "journal", label: "日记", match: (n: string) => n === "journal" },
            { key: "stats", label: "数据", match: (n: string) => n === "stats" }
          ] as const).map((item) => (
            <button
              key={item.key}
              className={`nav-item${item.match(view.name) ? " active" : ""}`}
              onClick={() => setView({ name: item.key } as View)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        {view.name !== "shelf" && <span className="topbar-title">{topTitle}</span>}
        <div className="topbar-right">
          <button className="icon-btn" title="设置" onClick={() => setSettingsOpen(true)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
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
      {/* v48.13（P2）：全局后台活动指示器——生成任务在主进程持有，与当前界面无关 */}
      <BackgroundActivity onOpenMap={(documentId, mapId) => void openMaterialMap(documentId, mapId)} />
      {addMaterialOpen && (
        <AddBookModal
          onSave={async (title, markdown, lang) => {
            const created = await libraryApi.createFromPaste(title, markdown);
            // v38（D35）：粘贴书随建册带上语言属性（空=未知）
            if (created && lang) await libraryApi.setItemLang(created.id, lang);
            eventBus.emit("library/changed");
            setAddMaterialOpen(false);
          }}
          onClose={() => setAddMaterialOpen(false)}
        />
      )}
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
