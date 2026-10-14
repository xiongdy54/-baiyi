import { useCallback, useEffect, useRef, useState, type ReactNode, type SetStateAction } from "react";
import { flushSync } from "react-dom";
import "./theme.css";
import Bookshelf from "./components/Bookshelf";
import Reader from "./components/Reader";
import ExtractReviewView from "./components/ExtractReviewView";
import ReviewView from "./components/ReviewView";
import CardBrowser from "./components/CardBrowser";
import JournalView from "./components/JournalView";
import AddBookModal from "./components/AddBookModal";
import SettingsPanel, { type ThemeMode } from "./components/SettingsPanel";
import Dashboard from "./components/dashboard/Dashboard";
// v48.80（D124）：数据页顶部「下一步」面板（不是 WidgetDef，不进布局编辑）；v48.81（D125）迁为顶栏独立页签页
import NextStepsPanel from "./components/learner/NextStepsPanel";
import { learnerSettings } from "./lib/learner";
import { learnerStrings } from "./lib/learnerStrings";
import { eventBus } from "./lib/eventbus";
import { settingsStore } from "./lib/settings";
import { commandRegistry } from "./lib/commands";
import { libraryApi, type DocPayload } from "./lib/library";
import { installJournalBridge, shortcutsApi } from "./lib/journal";
import { installInsightBridge } from "./lib/insight";
import { installMemoryBridge } from "./lib/memory";
import { installMindmapBridge, mindmapApi } from "./lib/mindmap";
import { installActivityStore, seedFromRuns } from "./lib/activity";
import { ensureDismissalsLoaded, isDismissed } from "./lib/activityDismiss";
import { BackgroundActivity } from "./components/BackgroundActivity";
import { readingWorkflow, parseContextRef, type ExtractSpan } from "./lib/readingWorkflow";
import { buildSyntheticEpub, mediaTypeForFilename, type SynthImage } from "./lib/epub";
import { getSkin, SKINS } from "./skins";
import { applyAccent } from "./lib/accentVar";
import { useThemePlugin } from "./lib/themePlugins";
import FreeWorkbenchHost from "./components/FreeWorkbenchHost";
import { WB_STATE_EVENT, requestWorkbenchToggle, type WorkbenchState } from "./lib/workbenchLayout";

declare global {
  interface Window {
    windowAPI?: {
      minimize(): void;
      maximize(): void;
      close(): void;
      openExternal(url: string): Promise<boolean>;
      /** D123：制卡台右侧放置时请主进程把窗口向右外延 deltaPx（最大化/余量不足返回 inner） */
      dockExtend?(deltaPx: number): Promise<{ mode: "extended" | "inner" }>;
      dockRestore?(): Promise<boolean>;
      /** D123：主进程在窗口被最大化等情形下告知「回落内推」 */
      onDockMode?(cb: (mode: "extended" | "inner") => void): () => void;
      /** D123：独立制卡台窗口（toggle/show/hide/pin） */
      workbench?(action: "toggle" | "show" | "hide" | "pin"): Promise<{ visible: boolean; pinned: boolean }>;
      /** D123：独立窗口建卡后通知主窗口刷新；主窗口订阅 */
      notifyCardsChanged?(): void;
      onCardsChanged?(cb: () => void): () => void;
      onWorkbenchShown?(cb: () => void): () => void;
    };
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
      /** v48.80（D124）：学习者模型「下一步」面板的 jump 动作返回来源页；v48.81（D125）面板页签化后返回「推荐」页 */
      returnTo?: "review" | "queue" | "browse" | "stats" | "next";
      /** v48.13（P2）：从右下角指示器「打开导图」进入时置位——Reader 挂载后自动打开导图工作区 */
      openMindmap?: boolean;
      /** v48.13（P2）：要展示的导图版本（候选版本——按发布模型不激活，但用户点了就该看到它） */
      openMindmapMapId?: string | null;
      /** v48.13（P3）：以同一 run 续跑（应用重启后发现未跑完的运行） */
      resumeRunId?: string | null;
    }
  | { name: "queue" }
  // v48.22（D58 §6.8-8）：本书范围的集中复习（阅读器「复习摘录 / 复习闪卡」入口）
  // v48.61（D105）：筛选牌组条件随视图带过（tags/kpIds 进 applyScope 过滤）
  | { name: "extractSession"; bookItemIds: string[]; title: string; limits?: Record<string, number> | null; scopeTags?: string[]; scopeKpIds?: string[] }
  | { name: "review"; bookItemIds?: string[]; title?: string; limits?: Record<string, number> | null; scopeTags?: string[]; scopeKpIds?: string[] }
  | { name: "browse"; /** v48.47（D87）：锚点筛选（来自浮窗「已制卡 N 张」点击） */ anchorExtractId?: string | null }
  | { name: "journal" }
  // v48.81（D125）：学习者模型「推荐」页签（面板模块名仍为「下一步」）——顶栏第 4 位；关闭学习者模型时页签收拢消失
  | { name: "next" }
  | { name: "stats" };

// D120-R2（MOTION-DESIGN-SPEC §5.1）：页序表——顶栏签从左至右的视觉序，与下方 nav 数组同序（不得另造）；
// v48.81（D125）起第 4 位为「推荐」页签（仅在学习者模型开启时在场，关闭后其余六签页序不变）；
// queue 与 extractSession 同席（顶栏同钮高亮）⇒ 互切 dir=0；reader 为深度视图（+∞，不列席，见 viewDirOf 特则）。
const VIEW_ORDER: Record<View["name"], number> = {
  shelf: 0,
  queue: 1,
  extractSession: 1,
  review: 2,
  next: 3,
  browse: 4,
  journal: 5,
  stats: 6,
  reader: Number.POSITIVE_INFINITY
};

// 方向判定（§5.1 唯一判定点）：fwd＝目标在右＝新页自右往左入（前进/深入）；bwd＝目标在左＝新页自左往右入（返回）；
// ""（dir=0）＝同席互切或 reader↔reader 跳转＝纯 crossfade 不位移。
// reader 特则：进入 reader 恒为 fwd（深入）、离开恒为 bwd（返回），不按数值比较（§3.4 方向语义一致）。
function viewDirOf(cur: View, next: View): "fwd" | "bwd" | "" {
  if (cur.name === "reader" || next.name === "reader") {
    if (cur.name === next.name) return "";
    return next.name === "reader" ? "fwd" : "bwd";
  }
  const d = VIEW_ORDER[next.name] - VIEW_ORDER[cur.name];
  return d === 0 ? "" : d > 0 ? "fwd" : "bwd";
}

// 顶栏静态六签（v12.1 文字主导航）。v48.81（D125）：「推荐」页签按总开关插在复习与卡片之间（见渲染处），不入本表。
const TOP_NAV = [
  { key: "shelf", label: "书架", match: (n: string) => n === "shelf" },
  { key: "queue", label: "摘录", match: (n: string) => n === "queue" || n === "extractSession" },
  { key: "review", label: "复习", match: (n: string) => n === "review" },
  { key: "browse", label: "卡片", match: (n: string) => n === "browse" },
  { key: "journal", label: "日记", match: (n: string) => n === "journal" },
  { key: "stats", label: "数据", match: (n: string) => n === "stats" }
] as const;

export default function App() {
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [skinId, setSkinId] = useState("none");
  const [accentColor, setAccentColor] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // D123：制卡台状态（宿主面板经 wb:state 事件同步；顶栏按钮只读它，静态方块点、无动画）
  const [wb, setWb] = useState<WorkbenchState>({ open: false, busy: false, draft: false });
  const settingsOpenRef = useRef(false);
  useEffect(() => {
    settingsOpenRef.current = settingsOpen;
  }, [settingsOpen]);
  useEffect(() => {
    const on = (e: Event) => setWb((e as CustomEvent<WorkbenchState>).detail);
    window.addEventListener(WB_STATE_EVENT, on);
    return () => window.removeEventListener(WB_STATE_EVENT, on);
  }, []);
  // D123：Ctrl/⌘+K 开合制卡台（任何页面；设置弹窗期间不响应；已被编辑器等 preventDefault 的不抢）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || settingsOpenRef.current) return;
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "k") return;
      e.preventDefault();
      requestWorkbenchToggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // D123：独立制卡台窗口建卡后，主窗口各页刷新
  useEffect(() => window.windowAPI?.onCardsChanged?.(() => eventBus.emit("cards/changed")), []);
  // v36（M8-A）：添加材料模态提升到 App 级——全局快捷键 Ctrl+Alt+N 与书架入口共用同一模态，
  // 且快捷键呼出时**不切换视图**（阅读位置与复习会话原地保留，D34-⑤）
  const [addMaterialOpen, setAddMaterialOpen] = useState(false);
  /* v48.15 / D51：顶栏「书架」被点时自增——已在书架时点它也要能退出文件夹回顶层（Bookshelf 的第二条出路） */
  const [shelfTopTick, setShelfTopTick] = useState(0);
  const [view, setView] = useState<View>({ name: "shelf" });
  // D120-R2（§5.1）：changeView 的方向判定需同步读到「当前视图」——viewRef 镜像 view：
  // changeView 在改 view 的同一时刻**同步推进**镜像（第 1 轮审查 LOW-1：仅靠 passive effect
  // 回写时，同帧第二次 changeView 会读到旧值、方向错一档），下方 effect 兜底其余路径。
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  // 世代号：快速连点时新过渡会跳过旧过渡（旧 finished 仍会结算）——旧清理不得误删新过渡刚写入的标记
  const vtGenRef = useRef(0);
  // v48.41（D81）：摘录/复习会话的顶栏标题＝**当前卡材料名**（两页经 onMaterialName 上报；
  // 空串＝当前卡无材料名或队列为空，回落原「摘录」/「复习」字样）。切视图即失效重报。
  const [sessionMaterial, setSessionMaterial] = useState("");
  useEffect(() => {
    setSessionMaterial("");
  }, [view.name]);
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
    // v48.13（P3）：启动时用「可续跑运行」播种指示器——上次被关闭打断的那轮，
    // 用户需要看到「可以继续」，而不是在账本上被记成一次失败。
    void (async () => {
      try {
        const pending = await mindmapApi.pendingRuns();
        // v48.17（D53）：用户点过「关闭」的那些不再回来。判定交给 seedFromRuns，
        // 由它在同材料去重**之后**再问——先去重再问会让更旧的历史运行递补上来（GUI 实测复现过）。
        await ensureDismissalsLoaded();
        seedFromRuns(
          (pending || []).map((r) => ({
            id: r.id,
            documentId: r.documentId,
            status: r.status,
            materialTitle: r.materialTitle,
            callsDone: r.callsDone,
            updatedAt: r.updatedAt
          })),
          isDismissed
        );
      } catch {
        /* 播种失败不影响启动 */
      }
    })();
    return shortcutsApi.onOpenAddMaterial(() => setAddMaterialOpen(true));
  }, []);

  // M4：设置弹窗打开期间抑制全局快捷键（弹窗无输入焦点时按键不得触发其下层的复习/阅读动作）
  useEffect(() => {
    if (settingsOpen) commandRegistry.pushSuppress("settings-modal");
    else commandRegistry.popSuppress("settings-modal");
    return () => commandRegistry.popSuppress("settings-modal");
  }, [settingsOpen]);

  useEffect(() => {
    // 以**解析后**的皮肤为准，而不是持久化的原始 skinId：注册表里已删除的旧 id 会回落到
    // 默认皮肤，此时若仍按原始值挂 has-skin，body 与顶栏背景被清空却没有皮肤层垫在下面，
    // 整页会透出窗口底色。
    const resolvedSkin = getSkin(skinId);
    document.body.classList.toggle("has-skin", resolvedSkin.id !== "none");
    document.body.classList.remove(
      ...SKINS.filter((s) => s.bodyClass).map((s) => s.bodyClass as string)
    );
    if (resolvedSkin.bodyClass) document.body.classList.add(resolvedSkin.bodyClass);
  }, [skinId]);

  useEffect(() => {
    // 单一入口：自定义 accent 必须同步 --accent-on，否则浅色 accent 上白字不可读
    applyAccent(accentColor);
  }, [accentColor]);

  // v48.89（D132 §6.4）：主题插件注入链（<style data-plugin-css> + --pl-* 内联变量；多窗口各自调用）
  useThemePlugin();

  async function handleThemeChange(m: ThemeMode) {
    setTheme(m);
    await settingsStore.set("theme", "mode", m);
    eventBus.emit("theme/changed", m);
    eventBus.emit("settings/changed", { scope: "theme", key: "mode" });
  }

  async function handleSkinChange(id: string) {
    setSkinId(id);
    // v48.89（D132 §7.3/§8.3）：内置皮肤与主题插件双槽互斥——选非 none 皮肤时同步清插件激活
    //（宿主 setActive 写两槽；skin 列表选中态因 app.skinId 被写回 none 由插件侧驱动回落）
    if (id !== "none") void window.pluginsAPI?.setActive("");
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

  // v48.76（D120 / MOTION-DESIGN-SPEC §5）：页面切换统一入口——全部**跨视图**切换只走这一个口子，
  // 经原生 View Transitions API crossfade（旧视图 100ms 出 / 新视图 200ms 入，缓动与 exclude 规则见 theme.css「页面切换」节）；
  // flushSync 保证回调返回前 DOM 已提交：浏览器在回调结束后立即捕获新视图快照，
  // React 18 异步渲染下不加 flushSync 会拍到同帧（crossfade 拍出两个相同画面）。
  // D120-R2（§5.1/§5.2）：调 startViewTransition **之前**同步写 documentElement 的
  // data-vt（入场闸门：过渡遮罩在场）与 data-vt-dir（fwd=新页自右入 / bwd=自左入；dir=0 同席不写）；
  // transition.finished 结算（finally 兜底，含跳过/失败路径）后删除两属性——
  // 闸门关闭期间挂载的入场动画被推迟到揭幕后从头播放（§5.2），方向位移由 CSS 按 data-vt-dir 选取。
  const changeView = useCallback((next: SetStateAction<View>) => {
    // TS 5.5 lib.dom 尚无 startViewTransition 类型：局部特性检测声明，不污染全局类型
    const host = document as unknown as { startViewTransition?: (update: () => void) => { finished: Promise<void> } };
    const cur = viewRef.current; // 当前视图镜像（§5.1 方向判定的同步读取点）
    const nextView = typeof next === "function" ? next(cur) : next;
    const dir = viewDirOf(cur, nextView);
    if (typeof host.startViewTransition !== "function") {
      // 降级（§5.1）：不写 dataset，瞬时切换，方向动效自然不在场
      setView(nextView);
      viewRef.current = nextView; // LOW-1：镜像同步推进（同帧双 changeView 不读旧值）
      return;
    }
    const root = document.documentElement;
    root.dataset.vt = "1"; // §5.2 入场闸门：过渡遮罩在场
    if (dir) root.dataset.vtDir = dir;
    else delete root.dataset.vtDir; // dir=0（同席互切 / reader↔reader）：纯 crossfade 不位移
    const gen = ++vtGenRef.current;
    const clearVtMarkers = () => {
      if (vtGenRef.current !== gen) return; // 已被更新的过渡接管，其清理负责删除
      delete root.dataset.vt;
      delete root.dataset.vtDir;
    };
    host.startViewTransition(() => {
      flushSync(() => setView(nextView));
      viewRef.current = nextView; // LOW-1：flushSync 提交后同步推进镜像，同帧双 changeView 方向判定不再读旧值
    }).finished
      .catch(() => { /* 跳过/失败路径同样结算，统一走 finally 清理 */ })
      .finally(clearVtMarkers);
  }, []);

  const openBook = useCallback((itemId: string) => {
    libraryApi.getDocument(itemId).then(async (doc) => {
      if (!doc) return;
      const book = await loadReaderBook(itemId, doc);
      changeView({ name: "reader", itemId, doc, book });
    });
  }, [changeView, loadReaderBook]);

  const backToShelf = useCallback(() => changeView({ name: "shelf" }), [changeView]);

  // v48.13（P2）：右下角指示器「打开导图」——已在读该材料则就地打开工作区，
  // 否则先按 documentId 找回书架条目、载入内核，再带 openMindmap 标记进入（Reader 挂载后自动打开）。
  const openMaterialMap = useCallback(
    async (documentId: string, mapId?: string | null, resumeRunId?: string | null) => {
      if (view.name === "reader" && view.doc.documentId === documentId) {
        // 就地更新：已在同一 reader 视图（不跨视图，不走 changeView 过渡）
        setView({ ...view, openMindmap: true, openMindmapMapId: mapId ?? null, resumeRunId: resumeRunId ?? null });
        return;
      }
      const itemId = await libraryApi.getItemIdByDocumentId(documentId);
      if (!itemId) return;
      const doc = await libraryApi.getDocument(itemId);
      if (!doc) return;
      const book = await loadReaderBook(itemId, doc);
      changeView({ name: "reader", itemId, doc, book, openMindmap: true, openMindmapMapId: mapId ?? null, resumeRunId: resumeRunId ?? null });
    },
    [view, changeView, loadReaderBook]
  );

  // v48.23（D61 §6.8-11）：多段不相邻选择时，spans 与 contentMarkdown 一起过桥——
  // 主进程按 spans 优先装配文本与 quote_range_json（≥2 段才传；单段路径载荷不变）。
  // 规格 §1.2：摘录复习页（queue / extractSession）里也能就地另立**子摘录**——
  // 当前摘录 id 与「所选文字在父卡正文里的偏移」由 ExtractReviewView 的卡面采集（ctx.parentRange），
  // contextRef 在此**唯一一处**补 parentExtractId / rootExtractId / parentRange（根＝自身 id 由 db 侧补）。
  const handleExtract = useCallback(
    async (
      text: string,
      spans?: ExtractSpan[],
      ctx?: { parentExtractId?: string; parentRange?: Array<{ start: number; end: number }> }
    ) => {
      const multi = spans && spans.length >= 2 ? spans : undefined;
      if (view.name === "reader") {
        await readingWorkflow.create({
          parentType: "document",
          parentId: view.doc.documentId,
          documentId: view.doc.documentId,
          contentMarkdown: text,
          spans: multi
        });
      } else if ((view.name === "queue" || view.name === "extractSession") && ctx?.parentExtractId) {
        // 复习中从父建（R11）：父摘录的 documentId / rootExtractId 从库里取回，不靠渲染层猜
        const parent = await readingWorkflow.getTopic(ctx.parentExtractId);
        if (!parent) return;
        const parentRef = parseContextRef(parent.contextRefJson);
        await readingWorkflow.create({
          parentType: "extract",
          parentId: parent.id,
          documentId: parent.documentId,
          contentMarkdown: text,
          spans: multi,
          contextRef: {
            documentId: parent.documentId,
            extractId: parent.id,
            parentExtractId: parent.id,
            rootExtractId: String(parentRef?.rootExtractId || parent.id),
            // 工单 ②：父卡坐标下的引文范围——子卡「跳转原文」回父卡时高亮的就是它（零迁移，JSON 列）
            ...(Array.isArray(ctx.parentRange) && ctx.parentRange.length ? { parentRange: ctx.parentRange } : {})
          }
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

  // 「跳转原文」（复习卡 / 队列摘录 / 卡片浏览 共用）：documentId 反查书架条目，以锚点打开阅读器，
  // 返回按钮回到来源页。跳转属「现场查看」语义（v19）：本次阅读器会话不落阅读进度与阅读字数，
  // 切出后软件记录的位置仍是上次真实阅读的位置，不会被跳转位置覆盖。
  const handleJumpToDoc = useCallback(async (
    docId: string,
    anchor: NonNullable<Extract<View, { name: "reader" }>["jumpAnchor"]>,
    returnTo: "review" | "queue" | "browse" | "stats" | "next" = "review"
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
      changeView({ name: "reader", itemId, doc, book, jumpAnchor: anchor, returnTo });
    }
  }, [changeView, loadReaderBook]);

  // v48.80（D124 §11.3）：学习者模型「下一步」面板的动作分派（copy-query 与 dialog 在面板内部处理，不走 App）
  useEffect(() => {
    return eventBus.on("learner/navigate", (payload) => {
      const p = payload as
        | { type: "open-book"; libraryItemId: string }
        | { type: "jump"; documentId: string; anchor: NonNullable<Extract<View, { name: "reader" }>["jumpAnchor"]> }
        | { type: "review"; scopeKpIds: string[]; title?: string }
        | { type: "extract-session"; bookItemIds: string[]; title?: string }
        | null;
      if (!p) return;
      if (p.type === "open-book") openBook(p.libraryItemId);
      else if (p.type === "jump") void handleJumpToDoc(p.documentId, p.anchor, "next");
      else if (p.type === "review") changeView({ name: "review", scopeKpIds: p.scopeKpIds, title: p.title });
      else if (p.type === "extract-session") changeView({ name: "extractSession", bookItemIds: p.bookItemIds, title: p.title ?? "" });
    });
    // openBook / handleJumpToDoc 均为 useCallback（changeView 稳定）；面板只在「下一步」页挂载，闭包时效可接受
  }, [openBook, handleJumpToDoc, changeView]);

  // v48.81（D125）：顶栏「推荐」页签随总开关在场——读 app.learner.enabled 并订阅 settings/changed。
  // 关闭：页签先横向收拢（.nav-collapse，§7 折叠的水平变体）后卸载；若正处「推荐」页则退回数据页。
  const [learnerEnabled, setLearnerEnabled] = useState<boolean | null>(null);
  const [nextTabClosing, setNextTabClosing] = useState(false);
  const nextCloseTimer = useRef<number | null>(null);
  useEffect(() => {
    void (async () => setLearnerEnabled((await learnerSettings.read()).enabled))();
    return eventBus.on("settings/changed", (p) => {
      if ((p as { key?: string } | undefined)?.key !== "learner") return;
      void (async () => {
        const on = (await learnerSettings.read()).enabled;
        setLearnerEnabled(on);
        if (on) {
          if (nextCloseTimer.current != null) {
            window.clearTimeout(nextCloseTimer.current);
            nextCloseTimer.current = null;
          }
          setNextTabClosing(false);
        } else {
          setNextTabClosing(true); // 320ms > 收拢时长 --dur-view(200ms)，动画播完再卸载
          if (nextCloseTimer.current != null) window.clearTimeout(nextCloseTimer.current);
          nextCloseTimer.current = window.setTimeout(() => {
            setNextTabClosing(false);
            nextCloseTimer.current = null;
          }, 320);
          if (viewRef.current.name === "next") changeView({ name: "stats" });
        }
      })();
    });
  }, [changeView]);

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
  // v48.81（D125）：界面文字（「推荐」页签 /「下一步」标题）取自学习者字符串表（§11.9）；静态六签渲染器
  const LS = learnerStrings();
  const navItem = (item: (typeof TOP_NAV)[number]) => (
    <button
      key={item.key}
      className={`nav-item${item.match(view.name) ? " active" : ""}`}
      onClick={() => {
        changeView({ name: item.key } as View);
        if (item.key === "shelf") setShelfTopTick((t) => t + 1);
      }}
    >
      {item.label}
    </button>
  );

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
        sourceAuthor={view.doc.author ?? undefined}
        onBack={view.jumpAnchor ? () => changeView({ name: view.returnTo ?? "review" } as View) : backToShelf}
        onSwitchAppTheme={handleThemeChange}
        // 跳转进入（jumpAnchor 存在）时不传 onProgress：Reader 的滚动/卸载保存全部失效，
        // 阅读进度与阅读字数保持上次真实阅读的值（v19 现场查看语义）
        onProgress={view.jumpAnchor ? undefined : handleDocProgress}
        openMindmapInitially={Boolean(view.openMindmap)}
        openMindmapMapId={view.openMindmapMapId ?? null}
        resumeRunId={view.resumeRunId ?? null}
        onReviewExtracts={() => changeView({ name: "extractSession", bookItemIds: [view.itemId], title: view.doc.title })}
        onReviewCards={() => changeView({ name: "review", bookItemIds: [view.itemId], title: view.doc.title })}
        onOpenAnchorCards={(extractId) => changeView({ name: "browse", anchorExtractId: extractId })}
        // 就地清除标记（同一 reader 视图），非页面切换，不走 changeView
        onMindmapOpened={() => setView((v) => (v.name === "reader" ? { ...v, openMindmap: false, resumeRunId: null } : v))}
      />
    );
  } else if (view.name === "queue") {
    // v48.22（D58 §6.8）：原「学习队列」列表页退役——列表职能迁入卡片浏览器，
    // 本页改为**沉浸式摘录连续处理页**（一屏一条、连续推进、正文可就地编辑）
    topTitle = sessionMaterial || "摘录";
    mainContent = (
      <ExtractReviewView
        onJumpToDoc={handleJumpToDoc}
        onMaterialName={setSessionMaterial}
        onExtract={(text, ctx) => void handleExtract(text, undefined, ctx)}
        onOpenAnchorCards={(extractId) => changeView({ name: "browse", anchorExtractId: extractId })}
      />
    );
  } else if (view.name === "extractSession") {
    // 本书范围会话（阅读器「复习摘录」入口）：只处理该书摘录，退出回阅读
    topTitle = sessionMaterial || "摘录";
    mainContent = (
      <ExtractReviewView
        onJumpToDoc={handleJumpToDoc}
        bookItemIds={view.bookItemIds}
        scopeLimits={view.limits ?? null}
        scopeTags={view.scopeTags}
        scopeKpIds={view.scopeKpIds}
        header={`处理摘录：《${view.title}》`}
        onExit={() => changeView({ name: "shelf" })}
        onMaterialName={setSessionMaterial}
        onExtract={(text, ctx) => void handleExtract(text, undefined, ctx)}
        onOpenAnchorCards={(extractId) => changeView({ name: "browse", anchorExtractId: extractId })}
      />
    );
  } else if (view.name === "review") {
    // v48.41（D81）：顶栏显示当前卡材料名（无材料名回落「复习」/「复习 · 牌组名」）
    topTitle = sessionMaterial || (view.title ? `复习 · ${view.title}` : "复习");
    mainContent = <ReviewView onJumpToDoc={handleJumpToDoc} bookItemIds={view.bookItemIds} scopeLimits={view.limits ?? null} scopeTags={view.scopeTags} scopeKpIds={view.scopeKpIds} onMaterialName={setSessionMaterial} />;
  } else if (view.name === "browse") {
    topTitle = "卡片浏览";
    mainContent = (
      <CardBrowser
        onJumpToDoc={handleJumpToDoc}
        anchorExtractId={view.name === "browse" ? view.anchorExtractId ?? null : null}
        // 就地清除锚点筛选（同一 browse 视图），非页面切换，不走 changeView
        onClearAnchorFilter={() => setView((v) => (v.name === "browse" ? { ...v, anchorExtractId: null } : v))}
        onStartSession={({ bookItemIds, tags, kpIds, kinds, name, limits }) => {
          // v48.22（D58 §6.8-5）：从筛选牌组进入集中复习——摘录范围走沉浸式摘录页，闪卡范围走复习页；
          // 牌组的上限覆写随视图带过去（只收紧，不另开预算）
          if (!kinds.includes("card")) changeView({ name: "extractSession", bookItemIds, title: name, limits: limits ?? null, scopeTags: tags, scopeKpIds: kpIds });
          else changeView({ name: "review", bookItemIds, title: name, limits: limits ?? null, scopeTags: tags, scopeKpIds: kpIds });
        }}
      />
    );
  } else if (view.name === "journal") {
    topTitle = "日记";
    mainContent = <JournalView onJumpToDoc={handleJumpToDoc} />;
  } else if (view.name === "next") {
    // v48.81（D125）：「推荐」页签页（顶栏标题沿模块全名「下一步」，同 卡片→卡片浏览 模式）。关闭学习者模型时页签收拢消失，本视图由 App 退回数据页
    topTitle = LS.panel.title;
    mainContent = <NextStepsPanel />;
  } else if (view.name === "stats") {
    topTitle = "统计数据";
    mainContent = <Dashboard />;
  } else {
    mainContent = (
      <Bookshelf
        onOpenBook={openBook}
        onAddMaterial={() => setAddMaterialOpen(true)}
        topLevelSignal={shelfTopTick}
      />
    );
  }

  return (
    <div className="app-shell">
      {loadError && (
        <div className="startup-warning">
          <span>{loadError}</span>
          <button onClick={() => setLoadError(null)}>知道了</button>
        </div>
      )}
      {skin.id !== "none" && (
        <div className="skin-layer">
          <SkinComponent {...skin.props} />
        </div>
      )}
      <header className="topbar">
        {/* 文字主导航（v12.1）：常驻左侧，当前项 accent 高亮；书架视图不再渲染品牌字块。
            v48.81（D125）：「下一步」页签按总开关插在复习与卡片之间（顶栏第 4 位）；
            关闭学习者模型时经 .nav-collapse 横向收拢后卸载，右侧签前滑补位 */}
        <nav className="topbar-nav">
          {TOP_NAV.slice(0, 3).map(navItem)}
          {(learnerEnabled === true || nextTabClosing) && (
            <span className={`nav-collapse${nextTabClosing ? "" : " is-open"}`}>
              <button
                type="button"
                className={`nav-item${view.name === "next" ? " active" : ""}`}
                onClick={() => changeView({ name: "next" })}
              >
                {LS.panel.tab}
              </button>
            </span>
          )}
          {TOP_NAV.slice(3).map(navItem)}
        </nav>
        {view.name !== "shelf" && <span className="topbar-title">{topTitle}</span>}
        <div className="topbar-right">
          {/* D123：制卡台唯一入口（手动制卡 / AI 制卡 / AI 解释同一模块）；快捷键只在悬停提示里 */}
          <button
            type="button"
            className={`topbar-wb${wb.open ? " is-on" : ""}`}
            data-testid="workbench-entry"
            aria-pressed={wb.open}
            title="制卡台（Ctrl+K）"
            onClick={requestWorkbenchToggle}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="5" width="18" height="14" rx="1" />
              <path d="M7 10h10M7 14h6" />
            </svg>
            <span>制卡台</span>
            {wb.busy && <i className="topbar-wb-dot" aria-hidden="true" />}
          </button>
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
      <div className="app-main">
        {mainContent}
        {/* D123：无阅读上下文的页面（书架/复习/卡片/日记/数据）挂自由制卡台宿主；阅读器与摘录页自带宿主 */}
        {view.name !== "reader" && view.name !== "queue" && view.name !== "extractSession" && <FreeWorkbenchHost />}
      </div>
      {/* v48.13（P2）：全局后台活动指示器——生成任务在主进程持有，与当前界面无关 */}
      <BackgroundActivity onOpenMap={(documentId, mapId, resumeRunId) => void openMaterialMap(documentId, mapId, resumeRunId)} />
      {addMaterialOpen && (
        <AddBookModal
          onSave={async (title, markdown, lang) => {
            const created = await libraryApi.createFromPaste(title, markdown);
            // v38（D35）：粘贴书随建册带上语言属性（空=未知）
            if (created && lang) await libraryApi.setItemLang(created.id, lang);
            eventBus.emit("library/changed");
            // D120：成功关窗收口到 AddBookModal 的 requestClose()（两步走出场），父级不再直接卸载
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
