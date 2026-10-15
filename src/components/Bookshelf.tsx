// 书架（v48.15 / D51 重设计）。契约正本：指南 §5.3（网格与吸顶工具条）、
// §5.4（图注卡 / 文件夹卡 / 三区落点 / 持久化 / 退出路径 / 空态）。
//
// 本文件只负责「书架上怎么摆」：视图组织与交互。一行都不碰数据归属——
// 卡、摘录、进度、语言、领域标签仍各挂各书，写库调用与 v48.14 之前逐字相同
// （setItemTitle / setItemLang / remove），顺序与文件夹走 SettingsStore app 层。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { libraryApi, lastReadDisplay, BOOK_LANGUAGES, type LibraryItem } from "../lib/library";
import { eventBus } from "../lib/eventbus";
import {
  IconAlert, IconArrowLeft, IconEllipsis, IconFolderPlus, IconImport, IconLanguages,
  IconLayoutGrid, IconList, IconPencil, IconTrash,
} from "./icons";
import Dropdown from "./Dropdown";
import {
  createFolderWith, dayLabel, dissolveFolder, ensureOrder, folderAggregate, folderEntries, findFolder,
  folderOf, forgetItem, groupInto, itemProgress, loadShelf, moveAllOut, moveStep, renameFolder,
  saveShelf, saveViewPrefs, loadViewPrefs, moveRelativeTo, sortEntries, topEntries, ungroup, withCurrentArray,
  EMPTY_SHELF, pct,
  SHELF_DENSITIES, SHELF_SORTS,
  type ShelfDensity, type ShelfEntry, type ShelfFolder, type ShelfSort, type ShelfState, type ShelfViewMode,
} from "../lib/shelf";

// v45.1（用户反馈「封面偶尔加载失败」）：bookasset 协议注册现已提前（main.js），此处再兜底——
// 启动早期偶发请求失败时自动重试（至多 3 次，400ms 间隔）；仍失败则回落暖纸默认封面（v48.122/D167）。
const COVER_RETRY_MAX = 3;

/* v48.122 / D167：无封面默认封面「暖纸」——暖纸渐变底 + 居中书名（上方细规线）+ 有作者时底部署名。
   .book-card-title 类名保留（annotations/extract/marks/multiselect/d126/f49b 选择器锁定）。 */
function DefaultCover({ title, author }: { title: string; author?: string | null }) {
  return (
    <div className="default-cover">
      <p className="book-card-title">{title}</p>
      {author ? <p className="dc-author">{author}</p> : null}
    </div>
  );
}

/* 目录表无封面缩略的花押：CJK 取首字、拉丁取首字母大写（v48.122 / D167） */
function titleMonogram(title: string): string {
  return title.trim().charAt(0).toUpperCase();
}

function CoverImg({ itemId, filename, title, author }: { itemId: string; filename: string; title: string; author?: string | null }) {
  const [attempt, setAttempt] = useState(0);
  // D120-R2（MOTION-DESIGN-SPEC §10-R2）：封面解码淡入——解码完成（onLoad）前 is-loaded 不在场，
  // img 在 no-preference 环境下 opacity:0；成功后 150ms 淡入。失败回落暖纸封面（D167）不走此规则。
  const [loaded, setLoaded] = useState(false);
  if (attempt > COVER_RETRY_MAX) {
    return <DefaultCover title={title} author={author} />;
  }
  return (
    <img
      className={`cover-img${loaded ? " is-loaded" : ""}`}
      src={`bookasset://${itemId}/${filename}${attempt > 0 ? `?r=${attempt}` : ""}`}
      alt={title}
      onLoad={() => setLoaded(true)}
      onError={() => window.setTimeout(() => setAttempt((a) => a + 1), 400)}
    />
  );
}

/* 卡内动作条菜单（书籍语言 / 归入文件夹 / 文件夹操作）的弹出位置。
   动作条压在封面底缘，所以默认向上开；但两个方向都不天然放得下——
   滚动容器顶边与吸顶工具条会切掉越界部分（目录表首行实测向上缺 178px，10 个语言选项一个都点不到，
   用户实测第 1 条），长列表最后一行的向下菜单同样会被容器底边切掉；横向同理：
   「把 N 本全部移回书架」这类宽菜单右缘对齐时，最左一列会整体越到容器外（实测左越 72px）。
   所以开菜单时按默认位置量一次，哪一侧放不下就翻到另一侧（都放不下时保留默认＝越界最少的那侧）。 */
function CardMenu({ label, children }: { label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState({ down: false, left: false });
  useLayoutEffect(() => {
    const el = ref.current;
    const shelf = el?.closest<HTMLElement>(".bookshelf");
    const dd = el?.parentElement; // .dd：触发按钮的定位盒
    if (!el || !shelf || !dd) return;
    const area = shelf.getBoundingClientRect();
    const bar = shelf.querySelector<HTMLElement>(".shelf-bar");
    const safeTop = bar ? bar.getBoundingClientRect().bottom : area.top;
    const box = el.getBoundingClientRect();
    const w = box.width;
    const dr = dd.getBoundingClientRect();
    // 越界量（0 = 放得下）：上方还要躲开吸顶工具条，所以基准是工具条下沿而不是容器顶
    const overUp = Math.max(0, safeTop - box.top);
    const overDown = Math.max(0, dr.bottom + 4 + box.height - area.bottom);
    const overRightAnchored = Math.max(0, area.left - (dr.right - w)); // 默认「右缘对齐触发钮」的左侧越界
    const overLeftAnchored = Math.max(0, dr.left + w - area.right); // 改「左缘对齐」后的右侧越界
    setPlace({
      down: overUp > 0 && overDown < overUp,
      left: overRightAnchored > 0 && overLeftAnchored <= overRightAnchored,
    });
    // v48.117 / D162：deps 带 label——下钻式菜单（更多操作 → 语言/优先级/归组）同位换内容时
    // 组件只会 update 不会重挂，[] 依赖会让放置量测停在首层内容的高度上
  }, [label]);
  const { down, left } = place;
  return (
    <div
      ref={ref}
      className={`dd-menu dd-menu-${down ? "down" : "up"}${left ? " dd-menu-left" : ""}`}
      role="menu"
      aria-label={label}
      /* v48.117 / D162：菜单位于 .cap（图注点击靶＝打开书/进文件夹）内，必须整体挡冒泡——
         否则点任何菜单项都会顺手开书/进夹（旧 card-acts 由容器 stopBubble 承担，退役后改挂这里） */
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}

interface Props {
  onOpenBook: (itemId: string) => void;
  /** 添加材料选单（v49.3 / D177）的两条出口，均由 App 级持模态：书架选单与全局快捷键 Ctrl+Alt+N（直达粘贴）共用 */
  onImportFiles: () => void;
  onPasteMaterial: () => void;
  /** 顶栏「书架」被点击时自增（App 级）：已在书架时也用它退出文件夹回顶层（§5.4 三条出路之一） */
  topLevelSignal: number;
}

type MenuKind = "lang" | "group" | "folder" | "priority" | "more" | "add";
interface DragState { id: string; target: string | null; zone: "before" | "group" | "after" | null }

const ZONE_BEFORE = 0.28;
const ZONE_AFTER = 0.72;
const PAPERS_MAX = 3;
const DENSITY_CLASS: Record<ShelfDensity, string> = { sm: "dens-sm", md: "", lg: "dens-lg" };

/* 模块级缓存（stale-while-revalidate）：书架在切页时会被卸载重挂，若每次都从空态起步，
   首帧会闪出「书架还是空的」。缓存上次的数据让重挂载首帧即带内容，后台再静默刷新。 */
const shelfCache: {
  items: LibraryItem[] | null;
  shelf: ShelfState | null;
  prefs: { mode: ShelfViewMode; density: ShelfDensity; sort: ShelfSort } | null;
} = { items: null, shelf: null, prefs: null };

export default function Bookshelf({ onOpenBook, onImportFiles, onPasteMaterial, topLevelSignal }: Props) {
  const [items, setItems] = useState<LibraryItem[]>(shelfCache.items ?? []);
  const [shelf, setShelf] = useState<ShelfState>(shelfCache.shelf ?? EMPTY_SHELF);
  // 数据是否已就绪：有缓存＝立刻就绪；冷启动＝等首次加载完成，期间不渲染空态
  const [dataReady, setDataReady] = useState(shelfCache.items !== null && shelfCache.shelf !== null);
  const [sort, setSort] = useState<ShelfSort>(shelfCache.prefs?.sort ?? "manual");
  const [mode, setMode] = useState<ShelfViewMode>(shelfCache.prefs?.mode ?? "wall");
  const [density, setDensity] = useState<ShelfDensity>(shelfCache.prefs?.density ?? "md");
  const [openFolderId, setOpenFolderId] = useState<string | null>(null);
  // field="author"：同一输入框复用于编辑作者（D121 §1.1；空=未知）
  const [renaming, setRenaming] = useState<{ id: string; value: string; field?: "author" } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; kind: MenuKind } | null>(null);
  // 添加材料选单的触发钮（D177）：选单项点击先把焦点归还触发钮再开模态——
  // menu 关闭语义（焦点回触发点）+ dialogA11y「归还触发元素」契约在两步入口下都成立
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  // 原生拖拽结束后浏览器不重判 :hover（拖动期间 hover 不更新）→ 被拖那张卡会顶着起手那一刻的
  // hover 状态，动作条留在屏上直到下一次真实鼠标移动。这段时间里 hover 是「假」的，先按下不表，
  // 收到第一次真实 mousemove（浏览器此时已重判过 hover）再交还给它。
  const [hoverFrozen, setHoverFrozen] = useState(false);
  useEffect(() => {
    if (!hoverFrozen) return;
    const thaw = () => setHoverFrozen(false);
    document.addEventListener("mousemove", thaw, { once: true });
    return () => document.removeEventListener("mousemove", thaw);
  }, [hoverFrozen]);
  const [error, setError] = useState<string | null>(null);
  // v48.18 / D54：视图/密度/排序是组件内状态，进出阅读器会重挂载 → 必须落 SettingsStore
  const [prefsReady, setPrefsReady] = useState(shelfCache.prefs !== null);
  const [freshId, setFreshId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;

  const manual = sort === "manual";

  /* v48.18 / D54：视图 / 密度 / 排序的记忆
     这三个是组件内状态，而 Bookshelf 会在「进阅读器 → 回书架」时重挂载，
     所以不持久化就会每次被打回封面墙（用户实测的第 5 条）。
     写入不在首帧发生：否则挂载时那份默认值会把刚从磁盘读回来的存档盖掉。 */
  useEffect(() => {
    void loadViewPrefs().then((p) => {
      setMode(p.mode);
      setDensity(p.density);
      setSort(p.sort);
      shelfCache.prefs = { mode: p.mode, density: p.density, sort: p.sort };
      setPrefsReady(true);
    });
  }, []);
  useEffect(() => {
    if (!prefsReady) return;
    shelfCache.prefs = { mode, density, sort };
    saveViewPrefs({ mode, density, sort });
  }, [prefsReady, mode, density, sort]);

  /* 新入库的材料插到队首并高亮 1.2s（避免"导入完找不到"，§5.4）。
     首帧不算新增——否则开机就整墙闪一遍。 */
  const prevIds = useRef<Set<string> | null>(null);
  const refresh = useCallback(async () => {
    const list = await libraryApi.list();
    const ids = new Set(list.map((i) => i.id));
    const added = prevIds.current ? list.filter((i) => !prevIds.current!.has(i.id)) : [];
    prevIds.current = ids;
    shelfCache.items = list;
    setItems(list);
    if (added.length) {
      const id = added[0].id; // listItems() 按 created_at DESC，added[0] 就是最新那本
      setFreshId(id);
      window.setTimeout(() => setFreshId((f) => (f === id ? null : f)), 1200);
    }
    setShelf((prev) => {
      const next = ensureOrder(prev, list.map((i) => i.id));
      if (next !== prev) saveShelf(next);
      shelfCache.shelf = next;
      return next;
    });
  }, []);

  useEffect(() => {
    void (async () => {
      const loadedShelf = await loadShelf();
      shelfCache.shelf = loadedShelf;
      setShelf(loadedShelf);
      await refresh();
      setDataReady(true);
    })();
    return eventBus.on("library/changed", refresh);
  }, [refresh]);

  /* D120-R2（MOTION-DESIGN-SPEC §10-R2）：书架入场标记。
     触发＝挂载后 items 由空→非空的**首个渲染周期**——首屏数据到达与他页切回（新挂载周期）两条路径都覆盖。
     enterArmed 保证组件生命周期内只武装一次：此后的 refresh 回灌 / 排序 / 密度 / 视图切换
     都在无 shelf-enter 容器下渲染，自然不播；700ms（200 + 8×30 + 余量）后清除标记，
     防无关重渲染里的新建节点误播（§10-R2）。定时器随 effect 清理，卸载 / StrictMode 双挂载安全。
     文件夹进出（openFolderId 无持久化回填）变化时主动终止未完序列——§10-R2 排除项；
     视图/排序不监听：loadViewPrefs 的异步回填可能晚于 items 到达，会误杀首屏入场（700ms 余量兜底）。 */
  const [shelfEnter, setShelfEnter] = useState(false);
  const enterArmed = useRef(false);
  useEffect(() => {
    if (enterArmed.current || items.length === 0) return;
    enterArmed.current = true;
    setShelfEnter(true);
  }, [items]);
  useEffect(() => {
    if (!shelfEnter) return;
    const t = window.setTimeout(() => setShelfEnter(false), 700);
    return () => window.clearTimeout(t);
  }, [shelfEnter]);
  useEffect(() => {
    setShelfEnter(false);
  }, [openFolderId]);

  /* 顶栏「书架」点击 → 退出文件夹（首次挂载不触发，否则会打断刚进来的状态恢复） */
  const firstSignal = useRef(topLevelSignal);
  useEffect(() => {
    if (firstSignal.current === topLevelSignal) return;
    firstSignal.current = topLevelSignal;
    setOpenFolderId(null);
  }, [topLevelSignal]);

  /* Esc：先收菜单，再退文件夹（§5.4 三条出路之一） */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (menu) { setMenu(null); return; }
      if (openFolderId) { setOpenFolderId(null); setDrag(null); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menu, openFolderId]);

  /* 点外面收菜单 */
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".dd")) setMenu(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menu]);

  const entries = useMemo<ShelfEntry[]>(() => {
    const base = openFolderId ? folderEntries(shelf, items, openFolderId) : topEntries(shelf, items);
    return sortEntries(shelf, items, base, sort);
  }, [shelf, items, openFolderId, sort]);

  const bookCount = entries.filter((e) => e.kind === "book").length;
  const folderCount = entries.length - bookCount;
  const openFolder = openFolderId ? findFolder(shelf, openFolderId) : null;

  const commit = useCallback((next: ShelfState) => {
    setShelf(next);
    saveShelf(next);
  }, []);

  /* ---------------- 写库（与 v48.14 行为逐字相同，只是入口从 overlay 搬进动作条） ---------------- */

  async function confirmDelete(id: string, title: string) {
    setPendingDelete(null);
    setError(null);
    try {
      await libraryApi.remove(id);
      setShelf((prev) => {
        const next = forgetItem(prev, id);
        saveShelf(next);
        return next;
      });
      eventBus.emit("library/changed");
    } catch (err) {
      setError(`删除《${title}》失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // v38（D35）：书籍语言属性——查词语言路由的书籍级信号；改完即落库并刷新本地列表
  async function handleSetLang(id: string, lang: string) {
    setMenu(null);
    setError(null);
    try {
      await libraryApi.setItemLang(id, lang);
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, lang } : it)));
    } catch (err) {
      setError(`设置语言失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // v48.22（D58 §6.8-2）：书级默认优先级——新建摘录继承；**继承型摘录实时跟随**（用户单条改过的 'user' 不动）
  async function handleSetPriority(id: string, priority: number) {
    setMenu(null);
    setError(null);
    try {
      const r = await libraryApi.setPriority(id, priority);
      if (!r?.ok) throw new Error("设置失败");
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, priority } : it)));
    } catch (err) {
      setError(`设置优先级失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function commitRename() {
    const cur = renaming;
    setRenaming(null);
    if (!cur) return;
    const next = cur.value.trim();
    if (cur.field === "author") {
      const it = items.find((x) => x.id === cur.id);
      if (!it || next === (it.author ?? "")) return;
      setError(null);
      try {
        await libraryApi.setItemAuthor(cur.id, next);
        eventBus.emit("library/changed");
      } catch (err) {
        setError(`修改作者失败：${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }
    if (!next) return;
    if (findFolder(shelf, cur.id)) {
      if (next !== findFolder(shelf, cur.id)!.name) commit(renameFolder(shelf, cur.id, next));
      return;
    }
    const item = items.find((it) => it.id === cur.id);
    if (!item || next === item.title) return;
    setError(null);
    try {
      await libraryApi.setItemTitle(cur.id, next);
      eventBus.emit("library/changed");
    } catch (err) {
      setError(`改名失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /* ---------------- 顺序与归组 ---------------- */

  // 落点方位必须传进来：只画 zone-after 的高亮却不执行「之后插入」，用户看到的就是拖不动
  const reorderTo = (id: string, targetId: string, side: "before" | "after") => {
    const arr = currentArr();
    const next = moveRelativeTo(arr, id, targetId, side);
    if (next !== arr) commit(withCurrentArray(shelf, openFolderId, next));
  };
  const step = (id: string, dir: -1 | 1) => {
    const arr = currentArr();
    const next = moveStep(arr, id, dir);
    if (next !== arr) commit(withCurrentArray(shelf, openFolderId, next));
  };
  const currentArr = () => (openFolderId ? findFolder(shelf, openFolderId)?.items || [] : shelf.order);

  const group = (sourceId: string, targetId: string) => {
    const res = groupInto(shelf, sourceId, targetId, openFolderId);
    if (res.refused) { setError(res.refused); return; }
    commit(res.state);
    if (res.renameId) setRenaming({ id: res.renameId, value: findFolder(res.state, res.renameId)?.name || "" });
  };
  const createFolder = (bookId: string) => {
    const { state, folderId } = createFolderWith(shelf, bookId);
    commit(state);
    setMenu(null);
    setRenaming({ id: folderId, value: findFolder(state, folderId)?.name || "" });
  };
  const leaveFolder = (bookId: string) => {
    setMenu(null);
    commit(ungroup(shelf, bookId));
  };
  const openInto = (folderId: string) => { setMenu(null); setDrag(null); setOpenFolderId(folderId); };
  const backToTop = () => { setOpenFolderId(null); setDrag(null); };

  /* ---------------- 拖拽：三区落点 ---------------- */

  const zoneOf = (el: HTMLElement, clientX: number): "before" | "group" | "after" => {
    const r = el.getBoundingClientRect();
    // 文件夹内不建子文件夹（一层为限）→ 中央也当重排处理，左右各半
    if (openFolderId) return clientX < r.left + r.width / 2 ? "before" : "after";
    const t = (clientX - r.left) / r.width;
    return t < ZONE_BEFORE ? "before" : t > ZONE_AFTER ? "after" : "group";
  };
  const onItemDragOver = (id: string) => (e: React.DragEvent) => {
    const d = dragRef.current;
    if (!d || !manual || d.id === id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const zone = zoneOf(e.currentTarget as HTMLElement, e.clientX);
    if (d.target !== id || d.zone !== zone) setDrag({ ...d, target: id, zone });
  };
  const onItemDrop = (id: string) => (e: React.DragEvent) => {
    e.preventDefault();
    const d = dragRef.current;
    setDrag(null);
    if (!d || d.id === id) return;
    if (d.zone === "group") group(d.id, id);
    else reorderTo(d.id, id, d.zone === "after" ? "after" : "before");
  };

  /* 条目之间的空白（列间距 / 行间距 / 网格四周内边距）也是落点（v48.20 / D56，用户实测第 2 条）。
     这些位置的命中目标是网格容器本身，而容器原先没有任何拖拽处理器 → dragover 不被 preventDefault，
     浏览器判定「此处不可放」→ 指针变禁止图标、松开也根本不产生 drop。
     落点取最近的一格（中心距）再按指针在它左/右半判前后，与卡内两区同序、与刚才看到的高亮一致；
     只处理落在容器**本身**上的那一层，卡/行内的落点仍归各自的处理器。 */
  const nearestEntry = (clientX: number, clientY: number) => {
    let best: { id: string; cx: number; d: number } | null = null;
    for (const el of listRef.current?.querySelectorAll<HTMLElement>("[data-entry]") || []) {
      const r = (el.querySelector(".shelf-face") ?? el).getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const d = Math.hypot(clientX - cx, clientY - (r.top + r.height / 2));
      if (!best || d < best.d) best = { id: el.dataset.entry!, cx, d };
    }
    return best;
  };
  const onGridDragOver = (e: React.DragEvent) => {
    const d = dragRef.current;
    if (!d || !manual || e.target !== e.currentTarget) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const near = nearestEntry(e.clientX, e.clientY);
    if (!near || near.id === d.id) return;
    const zone = e.clientX < near.cx ? "before" : "after";
    if (d.target !== near.id || d.zone !== zone) setDrag({ ...d, target: near.id, zone });
  };
  const onGridDrop = (e: React.DragEvent) => {
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    const d = dragRef.current;
    setDrag(null);
    // 落在空白处时 target 由上一次 dragover 定下；没路过任何一格就松开 = 原地不动
    if (!d?.target || !d.zone || d.target === d.id) return;
    if (d.zone === "group") group(d.id, d.target);
    else reorderTo(d.id, d.target, d.zone === "after" ? "after" : "before");
  };
  const itemProps = (entry: ShelfEntry) => ({
    draggable: manual,
    onDragStart: (e: React.DragEvent) => {
      if (!manual) { e.preventDefault(); return; }
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/shelf-id", entry.id);
      setDrag({ id: entry.id, target: null, zone: null });
    },
    onDragOver: onItemDragOver(entry.id),
    onDrop: onItemDrop(entry.id),
    onDragEnd: () => { setDrag(null); setHoverFrozen(true); },
  });
  const zoneClass = (id: string) =>
    drag && drag.id !== id && drag.target === id && drag.zone
      ? ` zone-${drag.zone}`
      : "";

  /* ---------------- 卡片键盘：Enter 打开 / Alt+方向键逐格移动 ---------------- */

  // 拆开两件事：Enter/Space 只在**非原生**的可激活元素（.book-card / .cap 是 div[role=button]）上需要手写；
  // 目录表的书名现在是真 <button>，浏览器自己会把 Enter/Space 变成 click 并冒泡到 <td> 的 onClick——
  // 若两条路径都调 onOpenBook，回车一次会开两次书。所以目录表只挂「重排」这半截。
  const onReorderKeyDown = (entry: ShelfEntry) => (e: React.KeyboardEvent) => {
    if (!e.altKey) return;
    const dir = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : null;
    if (dir === null) return;
    e.preventDefault();
    e.stopPropagation();
    if (!manual) { setError("拖拽与逐格移动仅在「手动顺序」下可用"); return; }
    step(entry.id, dir);
    // 重排后焦点要跟着这一条走（否则列表重渲染把焦点丢回 body，连按不动）。
    // 原先这里硬查 `.book-card`——目录表里没有它，于是**目录表视图的 Alt+方向键一直连按不了**（v48.18 修）。
    requestAnimationFrame(() => {
      listRef.current?.querySelector<HTMLElement>(`[data-entry="${entry.id}"] .book-card, [data-entry="${entry.id}"] .t-open`)?.focus();
    });
  };
  const onCardKeyDown = (entry: ShelfEntry) => (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (entry.kind === "folder") openInto(entry.id);
      else onOpenBook(entry.id);
      return;
    }
    onReorderKeyDown(entry)(e);
  };

  /* ---------------- 渲染片段 ---------------- */

  const metaLine = (parts: (string | null)[]) => (
    <p className="cap-meta mono">
      {parts.filter(Boolean).map((t, i) => (
        <span key={i} style={{ display: "contents" }}>
          {i > 0 && <span className="sep" />}
          {t}
        </span>
      ))}
    </p>
  );

  /* v48.117 / D162：图注两行——①名称行（名称 + 右端 ⋯ 更多按钮）②meta 行。
     名称单行截断（书籍 JS 截 12 字 + …、文件夹 CSS ellipsis），title 属性恒存全名；
     点击名称就地改名（cap-input，Enter/失焦保存、Esc 取消）；操作全部收拢进 ⋯ 菜单（D162） */
  const caption = (entry: ShelfEntry, title: string, meta: (string | null)[]) => {
    const isFolder = entry.kind === "folder";
    const menuKind: MenuKind = isFolder ? "folder" : "more";
    // v48.117 / D162：菜单归属按 id 判（不限根层）——下钻（lang/priority/group）时菜单仍要挂在这张卡上
    const menuOpen = menu?.id === entry.id;
    const display = !isFolder && title.length > 12 ? `${title.slice(0, 12)}…` : title;
    return (
      <>
        <div className="cap-row">
          {renaming?.id === entry.id ? (
            <input
              className="cap-input"
              autoFocus
              value={renaming.value}
              title={renaming.field === "author" ? "作者（留空=未知），回车保存，Esc 取消" : "回车保存，Esc 取消"}
              aria-label={renaming.field === "author" ? "修改作者" : entry.kind === "folder" ? "修改文件夹名" : "修改书名"}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setRenaming({ id: entry.id, value: e.target.value, field: renaming.field })}
              onBlur={() => void commitRename()}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); void commitRename(); }
                else if (e.key === "Escape") { e.preventDefault(); setRenaming(null); }
                e.stopPropagation();
              }}
            />
          ) : (
            <p
              className="cap-title"
              title={title}
              onClick={(e) => { e.stopPropagation(); setRenaming({ id: entry.id, value: title }); }}
            >
              {display}
            </p>
          )}
          <span className="dd cap-more">
            <button
              type="button"
              className="cap-more-btn"
              title={isFolder ? "文件夹操作" : "更多操作"}
              aria-label={isFolder ? "文件夹操作" : "更多操作"}
              aria-haspopup="true"
              onClick={(e) => { e.stopPropagation(); setMenu(menuOpen ? null : { id: entry.id, kind: menuKind }); }}
            >
              <IconEllipsis />
            </button>
            {menuOpen && (entry.kind === "folder"
              ? menu.kind === "folder" ? folderMenu(entry.folder) : null
              : menu.kind === "more" ? moreMenu(entry)
              : menu.kind === "lang" ? langMenu(entry.item, entry.id)
              : menu.kind === "priority" ? priorityMenu(entry.item, entry.id)
              : menu.kind === "group" ? groupMenu(entry, entry.id)
              : null)}
          </span>
        </div>
        {metaLine(meta)}
      </>
    );
  };

  // v48.117 / D162：下钻式子菜单的返回项（回到「更多操作」根菜单）
  const backToMore = (id: string) => (
    <button type="button" role="menuitem" className="dd-item dd-back" key="back"
      onClick={() => setMenu({ id, kind: "more" })}>
      ‹ 更多操作
    </button>
  );

  const langMenu = (item: LibraryItem, backId?: string) => (
    <CardMenu label="书籍语言">
      {backId && backToMore(backId)}
      {BOOK_LANGUAGES.map((l) => (
        <button
          key={l.value || "unknown"}
          type="button"
          role="menuitemradio"
          aria-checked={(item.lang ?? "") === l.value}
          className={`dd-item${(item.lang ?? "") === l.value ? " dd-item-on" : ""}`}
          onClick={() => void handleSetLang(item.id, l.value)}
        >
          {l.label}
        </button>
      ))}
    </CardMenu>
  );

  // v48.22（D58 §6.8-2）：书级默认优先级（新建摘录继承；继承型摘录实时跟随）
  const priorityMenu = (item: LibraryItem, backId?: string) => (
    <CardMenu label="优先级">
      {backId && backToMore(backId)}
      {[10, 30, 50, 70, 90].map((p) => (
        <button
          key={p}
          type="button"
          role="menuitemradio"
          aria-checked={(item.priority ?? 50) === p}
          className={`dd-item${(item.priority ?? 50) === p ? " dd-item-on" : ""}`}
          onClick={() => void handleSetPriority(item.id, p)}
        >
          优先级 {p}
        </button>
      ))}
      <div className="dd-note">新建摘录继承此书优先级；书里已摘录的条目（未被单条改过）会同步跟随。</div>
    </CardMenu>
  );

  const groupMenu = (entry: ShelfEntry, backId?: string) => {
    const inFolder = entry.kind === "book" ? folderOf(shelf, entry.id) : null;
    return (
      <CardMenu label="归入文件夹">
        {backId && backToMore(backId)}
        {entry.kind === "book" && (
          <button type="button" role="menuitem" className="dd-item" onClick={() => createFolder(entry.id)}>
            新建文件夹并放入
          </button>
        )}
        {shelf.folders.map((f) => (
          <button
            key={f.id}
            type="button"
            role="menuitemradio"
            aria-checked={!!inFolder && inFolder.id === f.id}
            className={`dd-item${inFolder?.id === f.id ? " dd-item-on" : ""}`}
            onClick={() => { setMenu(null); if (entry.kind === "book") group(entry.id, f.id); }}
          >
            {f.name}<span className="n"> {f.items.length}</span>
          </button>
        ))}
        {inFolder && (
          <button type="button" role="menuitem" className="dd-item" onClick={() => leaveFolder(entry.id)}>
            移出「{inFolder.name}」
          </button>
        )}
      </CardMenu>
    );
  };

  const folderMenu = (f: ShelfFolder) => (
    <CardMenu label="文件夹操作">
      {/* v48.117 / D162：重命名主路径是点名称（键盘等价保留菜单项）；无删除——解散不删书记录 */}
      <button type="button" role="menuitem" className="dd-item"
        onClick={() => { setMenu(null); setRenaming({ id: f.id, value: f.name }); }}>
        重命名
      </button>
      <button type="button" role="menuitem" className="dd-item" onClick={() => { setMenu(null); commit(moveAllOut(shelf, f.id)); }}>
        把 {f.items.length} 本全部移回书架
      </button>
      <button type="button" role="menuitem" className="dd-item" onClick={() => { setMenu(null); commit(dissolveFolder(shelf, f.id)); }}>
        解散文件夹（不删书记录）
      </button>
    </CardMenu>
  );

  /* v48.117 / D162：书籍 ⋯ 根菜单——除重命名走「点名称就地改」外的全部操作收拢于此；
     语言/优先级/归组为下钻式（点入同位换内容）。重命名留菜单项作键盘等价路径 */
  const moreMenu = (entry: ShelfEntry) => {
    if (entry.kind !== "book") return null; // 类型收窄：只在书籍卡上被调用
    const item = entry.item;
    return (
      <CardMenu label="更多操作">
        <button type="button" role="menuitem" className="dd-item" aria-label="重命名"
          onClick={() => { setMenu(null); setRenaming({ id: entry.id, value: item.title }); }}>
          重命名
        </button>
        <button type="button" role="menuitem" className="dd-item" aria-label="作者"
          title={item.author ? `作者：${item.author}（点击修改）` : "设置作者（留空=未知）"}
          onClick={() => { setMenu(null); setRenaming({ id: entry.id, value: item.author ?? "", field: "author" }); }}>
          设置作者{item.author ? `：${item.author}` : ""}
        </button>
        <button type="button" role="menuitem" className="dd-item" aria-label="书籍语言"
          onClick={() => setMenu({ id: entry.id, kind: "lang" })}>
          书籍语言
        </button>
        <button type="button" role="menuitem" className="dd-item" aria-label="优先级" data-book-priority
          onClick={() => setMenu({ id: entry.id, kind: "priority" })}>
          优先级
        </button>
        <button type="button" role="menuitem" className="dd-item" aria-label="归入文件夹"
          onClick={() => setMenu({ id: entry.id, kind: "group" })}>
          归入文件夹
        </button>
        <button type="button" role="menuitem" className="dd-item dd-item-danger" aria-label="删除"
          onClick={() => { setError(null); setMenu(null); setPendingDelete(item.id); }}>
          删除…
        </button>
      </CardMenu>
    );
  };

  const confirmBox = (id: string, title: string) => (
    <div className="book-card-confirm" onClick={(e) => e.stopPropagation()}>
      <span className="book-card-confirm-title">确定删除《{title}》吗？</span>
      <div className="book-card-confirm-actions">
        <button className="btn btn-danger btn-sm" onClick={() => void confirmDelete(id, title)}>
          确认删除
        </button>
        {/* 焦点落在「取消」而不是「确认删除」：一次误按 Enter 不该删书（D50） */}
        <button className="btn btn-outline btn-sm" autoFocus onClick={() => setPendingDelete(null)}>
          取消
        </button>
      </div>
    </div>
  );

  /* v48.117 / D162：card-acts 动作条整体退役——书籍与文件夹的操作全部收进图注名称行的 ⋯ 菜单
     （见 caption / moreMenu / folderMenu），删除确认框仍就地压卡。 */

  const bookFace = (item: LibraryItem) =>
    item.cover ? (
      <CoverImg itemId={item.id} filename={item.cover} title={item.title} author={item.author} />
    ) : (
      <DefaultCover title={item.title} author={item.author} />
    );

  // index：视觉阅读序（先行后列＝entries 渲染序），供入场 stagger 的 --i（clamp 到 0-7 共 8 档，§3.6 预算）
  const wallCard = (entry: ShelfEntry, index: number) => {
    const isFolder = entry.kind === "folder";
    const title = isFolder ? entry.folder.name : entry.item.title;
    const agg = isFolder ? folderAggregate(items, entry.folder) : null;
    // v48.115 / D161 第三轮：文件夹不显示任何进度信息（用户指令）——进度轨留空、无均值
    const progress = isFolder ? 0 : itemProgress(entry.item);
    const members = isFolder ? entry.folder.items.map((id) => items.find((i) => i.id === id)).filter(Boolean) as LibraryItem[] : [];
    return (
      <div
        key={entry.id}
        data-entry={entry.id}
        className={`shelf-item${zoneClass(entry.id)}${drag?.id === entry.id ? " is-dragging" : ""}${freshId === entry.id ? " is-fresh" : ""}`}
        style={{ "--i": String(Math.min(index, 7)) } as React.CSSProperties}
        {...itemProps(entry)}
      >
        {/* .shelf-face = 封面 + 进度轨那一整块，拖拽/新入库的高亮框画在它身上（§5.4） */}
        <div className="shelf-face" data-ui="card">
        <div
          className="book-card"
          data-ui="shelf-item"
          tabIndex={0}
          role="button"
          title={title}
          aria-label={isFolder ? `打开文件夹「${title}」，含 ${agg!.n} 本` : `打开《${title}》`}
          onClick={() => (isFolder ? openInto(entry.id) : onOpenBook(entry.id))}
          onKeyDown={onCardKeyDown(entry)}
        >
          {isFolder ? (
            /* v48.116 / D161 第五轮：竖版文件夹（参照 uiverse mighty-pig-13 转置 90°，开口朝右、折边在左）——
               背板 + 纸组（一层 = 一本书，≤3；纸即封面：inline bookasset:// 背景，无封面回退锌灰）+ 盖板
               （z 序 0/1/2，标签页为两板伪元素）。纸右缘按 --ci 阶梯退，从盖板口沿缝露出书脊边；
               hover / 键盘焦点绕左折边 3D 开盖（rotateY 阶梯，stagger 20ms）；卡面零文字 */
            <div className="f-face">
              <div className="f-back" aria-hidden="true" />
              {members.length > 0 && (
                <div className="f-papers" aria-hidden="true">
                  {members.slice(0, PAPERS_MAX).map((m, pi) => (
                    <i
                      key={m.id}
                      style={{
                        "--ci": String(pi),
                        ...(m.cover ? { backgroundImage: `url(bookasset://${m.id}/${m.cover})` } : {}),
                      } as React.CSSProperties}
                    />
                  ))}
                </div>
              )}
              <div className="f-front" aria-hidden="true" />
            </div>
          ) : (
            <div className="book-card-cover">{bookFace(entry.item)}</div>
          )}
          {/* v48.117 / D162：动作条退役，删除的就地二次确认仍压在卡上（触发口在图注 ⋯ 菜单） */}
          {pendingDelete === entry.id && entry.kind === "book" && confirmBox(entry.id, entry.item.title)}
          {drag?.target === entry.id && drag.zone === "group" && (
            <span className="zone-tip">
              {drag.id === entry.id ? "" : entry.kind === "folder"
                ? `归入「${title.length > 10 ? `${title.slice(0, 10)}…` : title}」`
                : `与《${title.length > 10 ? `${title.slice(0, 10)}…` : title}》成组`}
            </span>
          )}
        </div>
        {/* v48.118 / D163：文件夹卡不渲染进度轨——聚合进度在夹上全面不显示（既有裁定补彻底） */}
        {!isFolder && <div className="cap-rail"><i style={{ width: pct(progress) }} /></div>}
        </div>
        {/* 批次 D（D-TEST-16）：图注（书名）此前渲染在带 onClick 的 .book-card **之外**，
            于是"点书名不开书、点封面才开"。点击与键盘行为与书卡同源（不改 .shelf-item，
            那会与拖拽三区语义打架）；改名态下 .cap 里是 cap-input，它自带 stopPropagation，
            所以点输入框不会误开书。 */}
        <div
          className="cap"
          role="button"
          tabIndex={0}
          aria-label={isFolder ? `打开文件夹「${title}」，含 ${agg!.n} 本` : `打开《${title}》`}
          onClick={() => (isFolder ? openInto(entry.id) : onOpenBook(entry.id))}
          onKeyDown={onCardKeyDown(entry)}
        >
          {caption(entry, title, isFolder
            ? [`${agg!.n} 本`, agg!.latest ? dayLabel(agg!.latest) : "未读"]
            : [pct(progress), dayLabel(entry.item.updatedAt) || "未读", (entry.item.lang || "").toUpperCase() || "—"])}
        </div>
      </div>
    );
  };

  const tableRow = (entry: ShelfEntry, index: number) => {
    const isFolder = entry.kind === "folder";
    const title = isFolder ? entry.folder.name : entry.item.title;
    const agg = isFolder ? folderAggregate(items, entry.folder) : null;
    // v48.115 / D161 第三轮：文件夹不显示任何进度信息（用户指令）——进度轨留空、无均值
    const progress = isFolder ? 0 : itemProgress(entry.item);
    const members = isFolder ? entry.folder.items.map((id) => items.find((i) => i.id === id)).filter(Boolean) as LibraryItem[] : [];
    // 打开只有一条路径：格子的 onClick（封面格与书名格共用）；键盘经 .t-open 的原生 click 冒泡上来
    const open = () => (isFolder ? openInto(entry.id) : onOpenBook(entry.id));
    const openLabel = isFolder ? `打开文件夹「${title}」，含 ${agg!.n} 本` : `打开《${title}》`;
    return (
      <tr
        key={entry.id}
        data-entry={entry.id}
        className={`${zoneClass(entry.id)}${drag?.id === entry.id ? " is-dragging" : ""}${isFolder ? " is-folder" : ""}`}
        style={{ "--i": String(Math.min(index, 7)) } as React.CSSProperties}
        {...itemProps(entry)}
      >
        {/* v48.18：撤掉「打开」列与拖拽把手列。打开的入口改到**封面与书名本身**（与卡片视图同一套语言：
            卡片视图本来就点封面/图注开书，目录表此前却点书名不开书——标题格只有 onKeyDown、没有 onClick）。
            拖拽本来就把 draggable 挂在整行上，两个把手都只是没有任何处理器的视觉提示 → 删掉后
            「按住条目空白处拖动」自然成立，可拖性改由 cursor: grab + 落点高亮承担。 */}
        <td className="col-cov" onClick={open} title={openLabel}>
          {isFolder ? (
            /* 目录表缩略＝文件夹卡同一语言的缩小版（.thumb 重设几何变量；无 hover 动效） */
            <span className="thumb">
              <span className="f-back" aria-hidden="true" />
              {members.length > 0 && (
                <span className="f-papers" aria-hidden="true">
                  {members.slice(0, PAPERS_MAX).map((m, pi) => (
                    <i
                      key={m.id}
                      style={{
                        "--ci": String(pi),
                        ...(m.cover ? { backgroundImage: `url(bookasset://${m.id}/${m.cover})` } : {}),
                      } as React.CSSProperties}
                    />
                  ))}
                </span>
              )}
              <span className="f-front" aria-hidden="true" />
            </span>
          ) : (
            <span className="thumb">{entry.item.cover
              ? <img className="cover-img" src={`bookasset://${entry.item.id}/${entry.item.cover}`} alt="" aria-hidden="true"
                onLoad={(e) => e.currentTarget.classList.add("is-loaded")} />
              : <span className="thumb-mono" aria-hidden="true">{titleMonogram(entry.item.title)}</span>}</span>
          )}
        </td>
        <td className="col-main" onClick={open}>
          {/* 真 <button>：读屏会报「打开《书名》」并带出可激活语义；Enter/Space 的原生 click 冒泡到上面的 td，
              所以这里**不再挂 onClick**（挂了就是开两次）。 */}
          <button type="button" className="t-open" aria-label={openLabel} title={title} onKeyDown={onReorderKeyDown(entry)}>
            <span className="t-title">{title}</span>
          </button>
          {isFolder ? (
            <>
              <div className="t-sub">{agg!.n} 本 · 悬停看成员</div>
              <div className="t-members">{members.map((m) => m.title).join(" · ")}</div>
            </>
          ) : (
            <div className="t-sub">{entry.item.progressJson ? lastReadDisplay(entry.item) : "尚未开始 · 全文开头"}</div>
          )}
          <div className="bar"><i style={{ width: pct(progress) }} /></div>
        </td>
        <td className="col-num">{isFolder ? "—" : pct(progress)}</td>
        <td className="col-num">{isFolder ? "—" : <span className="lang">{(entry.item.lang || "").toUpperCase() || "—"}</span>}</td>
        <td className="col-num">{isFolder ? (agg!.latest ? dayLabel(agg!.latest) : "—") : dayLabel(entry.item.updatedAt) || "—"}</td>
        <td className="col-num">{isFolder ? entry.folder.created.slice(5) : dayLabel(entry.item.createdAt)}</td>
        <td className="col-act">
          {pendingDelete === entry.id && !isFolder ? confirmBox(entry.id, entry.item.title) : (
            <>
              <button className="act" title={isFolder ? "重命名文件夹" : "重命名"} aria-label="重命名"
                onClick={() => setRenaming({ id: entry.id, value: title })}><IconPencil /></button>
              {isFolder ? (
                <span className="dd">
                  <button className="act" title="文件夹操作" aria-label="文件夹操作" aria-haspopup="true"
                    onClick={() => setMenu(menu?.id === entry.id && menu.kind === "folder" ? null : { id: entry.id, kind: "folder" })}>
                    <IconEllipsis />
                  </button>
                  {menu?.id === entry.id && menu.kind === "folder" && folderMenu(entry.folder)}
                </span>
              ) : (
                <>
                  <span className="dd">
                    <button className="act" title="书籍语言" aria-label="书籍语言" aria-haspopup="true"
                      onClick={() => setMenu(menu?.id === entry.id && menu.kind === "lang" ? null : { id: entry.id, kind: "lang" })}>
                      <IconLanguages />
                    </button>
                    {menu?.id === entry.id && menu.kind === "lang" && langMenu(entry.item)}                  </span>
                  <span className="dd">
                    <button className="act" title="归入文件夹" aria-label="归入文件夹" aria-haspopup="true"
                      onClick={() => setMenu(menu?.id === entry.id && menu.kind === "group" ? null : { id: entry.id, kind: "group" })}>
                      <IconFolderPlus />
                    </button>
                    {menu?.id === entry.id && menu.kind === "group" && groupMenu(entry)}
                  </span>
                  <button className="act is-danger" title="删除" aria-label="删除"
                    onClick={() => { setError(null); setMenu(null); setPendingDelete(entry.id); }}><IconTrash /></button>
                </>
              )}
            </>
          )}
        </td>
      </tr>
    );
  };

  /* ---------------- 工具条 ---------------- */

  const segBtn = (active: boolean, label: string, onClick: () => void, icon?: React.ReactNode) => (
    <button type="button" aria-pressed={active} title={label} aria-label={label} onClick={onClick}>
      {icon ?? label}
    </button>
  );

  const bar = (
    <div className="shelf-bar">
      <span className="shelf-count">
        {openFolder ? (
          <><b>{entries.length}</b> 本</>
        ) : (
          <>
            <b>{bookCount}</b> 本
            {folderCount > 0 && <> · <b>{folderCount}</b> 个文件夹</>}
          </>
        )}
      </span>
      {openFolder && (
        <span className="shelf-crumb">
          <button
            type="button"
            className={`btn btn-outline btn-sm${drag?.target === "__root" && drag.zone === "group" ? " is-hot" : ""}`}
            title="返回书架顶层；把书拖到这里 = 移回书架"
            onClick={backToTop}
            onDragOver={(e) => {
              if (!drag || !manual || drag.id === openFolderId) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (drag.target !== "__root") setDrag({ ...drag, target: "__root", zone: "group" });
            }}
            onDrop={(e) => {
              e.preventDefault();
              const d = dragRef.current;
              setDrag(null);
              if (d && openFolderId && items.some((i) => i.id === d.id)) leaveFolder(d.id);
            }}
          >
            <IconArrowLeft size={14} />
            返回书架
          </button>
          <span className="crumb-sep" />
          <span className="crumb-here">{openFolder.name}</span>
        </span>
      )}
      <span className="shelf-group" role="group" aria-label="视图">
        <span className="shelf-label">视图</span>
        <span className="shelf-seg">
          {segBtn(mode === "wall", "封面墙", () => setMode("wall"), <IconLayoutGrid />)}
          {segBtn(mode === "table", "目录表", () => setMode("table"), <IconList />)}
        </span>
      </span>
      <span className="shelf-group is-density" role="group" aria-label="密度">
        <span className="shelf-label">密度</span>
        <span className="shelf-seg">
          {SHELF_DENSITIES.map((d) => segBtn(density === d.value, d.label, () => setDensity(d.value), d.label))}
        </span>
      </span>
      <span className="shelf-group" role="group" aria-label="排序">
        <span className="shelf-label">排序</span>
        <Dropdown value={sort} options={SHELF_SORTS} onChange={(v) => setSort(v as ShelfSort)} title="排序方式" align="left" />
      </span>
      <span className="shelf-spacer" />
      {/* 拖拽提示只余停用说明（v48.120/D165）：手动顺序下的操作说明文字退役，Alt+←/→ 键盘等价语义不变 */}
      {!manual && <span className="shelf-hint">非手动顺序，拖拽已停用</span>}
      {/* 主行动纯文字（v48.119/D164）＋ 选单两分（v49.3/D177）：按钮点击弹「导入文件 / 粘贴材料」
          两项选单，原四合一导入面板收拢于此；快捷键 Ctrl+Alt+N 的注册契约不变（§4.2-21，直达粘贴） */}
      <span className="dd">
        <button
          type="button"
          ref={addBtnRef}
          className="btn btn-primary btn-sm"
          data-ui="button-primary"
          aria-haspopup="menu"
          aria-expanded={menu?.kind === "add"}
          onClick={() => setMenu(menu?.kind === "add" ? null : { id: "__toolbar__", kind: "add" })}
        >
          添加材料
        </button>
        {menu?.kind === "add" && (
          <div className="dd-menu" role="menu" aria-label="添加材料">
            <button
              type="button"
              role="menuitem"
              className="dd-item add-source-item"
              onClick={() => { setMenu(null); addBtnRef.current?.focus(); onImportFiles(); }}
            >
              <span className="add-source-main"><IconImport size={14} /> 导入文件</span>
              <span className="add-source-desc">EPUB / PDF / Word / TXT / Markdown…</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="dd-item add-source-item"
              onClick={() => { setMenu(null); addBtnRef.current?.focus(); onPasteMaterial(); }}
            >
              <span className="add-source-main"><IconPencil size={14} /> 粘贴材料</span>
              <span className="add-source-desc">全窗口 Markdown 编辑器，可设书名与语言</span>
            </button>
          </div>
        )}
      </span>
    </div>
  );

  return (
    <section className={`bookshelf ${DENSITY_CLASS[density]}${hoverFrozen ? " is-hover-frozen" : ""}`}>
      {bar}
      {error && (
        <p className="notice-bar card-marked-error" role="alert">
          <IconAlert />
          <span>{error}</span>
          <span className="notice-bar-actions">
            <button className="btn btn-outline btn-sm" onClick={() => setError(null)}>
              知道了
            </button>
          </span>
        </p>
      )}
      {!(dataReady && prefsReady) ? (
        /* 冷启动数据未到：留空占位（工具条已在），不闪空态；通常只持续几十毫秒 */
        <div className="shelf-pending" aria-busy="true" />
      ) : entries.length === 0 ? (
        /* 空态：一句话。不再放主行动按钮——工具条的「添加材料」已在同一视口常驻
           （v48.15 / D51，swiss 文档「状态设计 · empty」同步补了这条例外；v48.82/D126 几何装饰退役） */
        <div className="empty-state">
          <p className="empty-text">
            {openFolder
              ? "这个文件夹还是空的。把书拖到另一本书上，或用卡片动作条的「归入文件夹」往里放。"
              : "书架还是空的。用右上角的「添加材料」，或按 Ctrl+Alt+N，粘贴一段文本、导入 EPUB / Word / TXT / Markdown，开始你的渐进阅读。"}
          </p>
        </div>
      ) : mode === "wall" ? (
        <div className={`bookshelf-grid${shelfEnter ? " shelf-enter" : ""}`} ref={listRef} onDragOver={onGridDragOver} onDrop={onGridDrop}>{entries.map((e, i) => wallCard(e, i))}</div>
      ) : (
        <div className={`shelf-body${shelfEnter ? " shelf-enter" : ""}`} ref={listRef} onDragOver={onGridDragOver} onDrop={onGridDrop}>
          <table className="shelf-table">
            <thead>
              <tr>
                <th className="col-cov" />
                <th>书名 / 上次阅读</th>
                <th className="col-num">进度</th>
                <th className="col-num">语言</th>
                <th className="col-num">最近</th>
                <th className="col-num">添加</th>
                <th className="col-act" />
              </tr>
            </thead>
            <tbody>{entries.map((e, i) => tableRow(e, i))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
