// 书架视图组织层（v48.15 / D51，契约见指南 §5.4「书架文件夹」与 §4.2-3）
//
// 这里只回答「书架上怎么摆」：手动顺序 + 文件夹。两件事一律守住的边界：
// ① **不改任何数据归属**——卡 / 摘录 / 进度 / 领域标签仍各挂各书，统计、今日队列、
//    FSRS、导图、用户记忆一律不感知 order 与 folders；
// ② **不进数据库**——存 SettingsStore 的 app 层（先例＝仪表盘布局 settings.dashboard.layout），
//    备份包本就含 settings.json（electron/backup.js），故 M2 覆盖、零 schema 变更。
//    代价如实登记在 D51：将来接 AccountSyncProvider 时 id 数组的跨设备合并比列排序复杂，
//    届时一次性折算成 sort_order 列即可。
//
// 全部函数按「输入 state → 输出新 state」写（不就地改），既方便组件用 useState 套，
// 也方便单测直接喂夹具断言，不需要起 Electron。
import { settingsStore } from "./settings";
import { t } from "./i18n";
import type { LibraryItem } from "./library";

export type ShelfSort = "manual" | "recent" | "added" | "title";
export type ShelfViewMode = "wall" | "table";
export type ShelfDensity = "sm" | "md" | "lg";

export interface ShelfFolder {
  id: string;
  name: string;
  items: string[];
  /** 'YYYY-MM-DD'，只用于「添加时间」排序与展示 */
  created: string;
}

export interface ShelfState {
  /** 顶层条目序：既含未归组的书 id，也含文件夹 id（一个文件夹占一格） */
  order: string[];
  folders: ShelfFolder[];
}

export type ShelfEntry =
  | { kind: "book"; id: string; item: LibraryItem }
  | { kind: "folder"; id: string; folder: ShelfFolder };

export const EMPTY_SHELF: ShelfState = { order: [], folders: [] };
export const DEFAULT_FOLDER_NAME = "未命名文件夹";

const SETTINGS_SCOPE = "app";
const KEY_ORDER = "shelfOrder";
const KEY_FOLDERS = "shelfFolders";
// v48.18 / D54：工具条三档状态（视图 / 密度 / 排序）也要记。原先只存 order/folders，
// 切到目录表后一开书再回来就打回封面墙，用户每次都得重切一遍
const KEY_VIEW = "shelfView";
const KEY_DENSITY = "shelfDensity";
const KEY_SORT = "shelfSort";

/* ------------------------------------------------------------------ 持久化 */

export async function loadShelf(): Promise<ShelfState> {
  const [order, folders] = await Promise.all([
    settingsStore.get<string[]>(SETTINGS_SCOPE, KEY_ORDER, []),
    settingsStore.get<ShelfFolder[]>(SETTINGS_SCOPE, KEY_FOLDERS, []),
  ]);
  return {
    order: Array.isArray(order) ? order.filter((x) => typeof x === "string") : [],
    folders: Array.isArray(folders)
      ? folders.filter((f) => f && typeof f.id === "string" && Array.isArray(f.items))
      : [],
  };
}

/** 写入即忘：设置落盘失败不打断界面（下一次刷新仍以内存态为准），与仪表盘 persistLayout 同策略 */
export function saveShelf(state: ShelfState): void {
  void settingsStore.set(SETTINGS_SCOPE, KEY_ORDER, state.order);
  void settingsStore.set(SETTINGS_SCOPE, KEY_FOLDERS, state.folders);
}

export interface ShelfViewPrefs {
  mode: ShelfViewMode;
  density: ShelfDensity;
  sort: ShelfSort;
}
export const DEFAULT_VIEW_PREFS: ShelfViewPrefs = { mode: "wall", density: "md", sort: "manual" };
const VIEW_MODES: ShelfViewMode[] = ["wall", "table"];
const DENSITIES: ShelfDensity[] = ["sm", "md", "lg"];
const SORTS: ShelfSort[] = ["manual", "recent", "added", "title"];

/** 读工具条状态。磁盘值一律不可信任：不在枚举内就回落默认——
 *  一个坏字符串不该让书架渲染成工具条对不上号的视图 */
export async function loadViewPrefs(): Promise<ShelfViewPrefs> {
  const [mode, density, sort] = await Promise.all([
    settingsStore.get<string>(SETTINGS_SCOPE, KEY_VIEW, DEFAULT_VIEW_PREFS.mode),
    settingsStore.get<string>(SETTINGS_SCOPE, KEY_DENSITY, DEFAULT_VIEW_PREFS.density),
    settingsStore.get<string>(SETTINGS_SCOPE, KEY_SORT, DEFAULT_VIEW_PREFS.sort),
  ]);
  const pick = <T extends string>(v: string, allowed: readonly T[], fallback: T): T =>
    allowed.includes(v as T) ? (v as T) : fallback;
  return {
    mode: pick(mode, VIEW_MODES, DEFAULT_VIEW_PREFS.mode),
    density: pick(density, DENSITIES, DEFAULT_VIEW_PREFS.density),
    sort: pick(sort, SORTS, DEFAULT_VIEW_PREFS.sort),
  };
}

/** 与 saveShelf 同口径：写入即忘，落盘失败不打断界面 */
export function saveViewPrefs(prefs: ShelfViewPrefs): void {
  void settingsStore.set(SETTINGS_SCOPE, KEY_VIEW, prefs.mode);
  void settingsStore.set(SETTINGS_SCOPE, KEY_DENSITY, prefs.density);
  void settingsStore.set(SETTINGS_SCOPE, KEY_SORT, prefs.sort);
}

/** 按落点方位插入：before ＝插到目标之前，after ＝插到目标之后。
 *  moveTo 只会「插到之前」，于是拖到右邻居的左半区等于原地不动——
 *  右半区（zone-after）必须有「之后」这个动作才有意义（v48.18 / D54 修「拖不动」）*/
export function moveRelativeTo(arr: string[], id: string, targetId: string, side: "before" | "after"): string[] {
  if (side === "before") return moveTo(arr, id, targetId);
  if (id === targetId) return arr;
  const out = [...arr];
  const from = out.indexOf(id);
  if (from < 0) return arr;
  out.splice(from, 1);
  const to = out.indexOf(targetId);
  if (to < 0) return arr;
  out.splice(to + 1, 0, id);
  return out;
}

/* ---------------------------------------------------------------- 派生数据 */

const isFolderId = (id: string) => /^f\d+$/.test(id);
export const findFolder = (state: ShelfState, id: string) => state.folders.find((f) => f.id === id) || null;
/** 一本书最多只属于一个文件夹（一层为限，且不做隐式合并） */
export const folderOf = (state: ShelfState, bookId: string) =>
  state.folders.find((f) => f.items.includes(bookId)) || null;

/** 阅读进度 0-1：progressJson 的 ratio 优先，回退 fraction（内核写入的两个口径，见 §6.2 进度） */
export function itemProgress(item: LibraryItem): number {
  if (!item.progressJson) return 0;
  try {
    const p = JSON.parse(item.progressJson) as { ratio?: number; fraction?: number };
    const v = typeof p.ratio === "number" ? p.ratio : typeof p.fraction === "number" ? p.fraction : 0;
    return Math.min(1, Math.max(0, v || 0));
  } catch {
    return 0;
  }
}

export interface FolderAggregate {
  n: number;
  progress: number;
  latest: number;
  created: string;
}

export function folderAggregate(items: LibraryItem[], folder: ShelfFolder): FolderAggregate {
  const ms = folder.items.map((id) => items.find((i) => i.id === id)).filter(Boolean) as LibraryItem[];
  const n = ms.length;
  return {
    n,
    progress: n ? ms.reduce((s, m) => s + itemProgress(m), 0) / n : 0,
    latest: ms.reduce((s, m) => Math.max(s, m.updatedAt || 0), 0),
    created: folder.created,
  };
}

/** 库里的新书（或未落库的书）补进 order：未入册者插到队首，避免"导入完找不到" */
export function ensureOrder(state: ShelfState, itemIds: string[]): ShelfState {
  const known = new Set(state.order);
  const foldersNow = new Set(state.folders.map((f) => f.id));
  const missing = itemIds.filter((id) => !known.has(id) && !folderOf(state, id));
  const gone = new Set<string>([...state.order].filter((id) => isFolderId(id) ? !foldersNow.has(id) : !itemIds.includes(id)));
  // v48.118 / D163：载入即去重——治愈历史幽灵副本（旧版 groupInto 把夹内书写回过 order，
  // 脏 settings.shelfOrder 会在解散/移出时暴露成重复卡）
  const clean = dedupe(state.order).filter((id) => !gone.has(id));
  if (!missing.length && clean.length === state.order.length) return state;
  return { ...state, order: [...missing, ...clean] };
}

/** order 去重（保序保首现）——幽灵副本防御的唯一出口，勿在别处绕过它拼 order */
function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}

export function topEntries(state: ShelfState, items: LibraryItem[]): ShelfEntry[] {
  const byId = new Map(items.map((i) => [i.id, i] as const));
  const out: ShelfEntry[] = [];
  for (const id of state.order) {
    if (isFolderId(id)) {
      const folder = findFolder(state, id);
      if (folder) out.push({ kind: "folder", id, folder });
      continue;
    }
    const item = byId.get(id);
    // 已归组的书不在顶层重复出现（由文件夹卡自己报成员数）
    if (item && !folderOf(state, id)) out.push({ kind: "book", id, item });
  }
  return out;
}

export function folderEntries(state: ShelfState, items: LibraryItem[], folderId: string): ShelfEntry[] {
  const folder = findFolder(state, folderId);
  if (!folder) return [];
  const byId = new Map(items.map((i) => [i.id, i] as const));
  return folder.items
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((item) => ({ kind: "book" as const, id: (item as LibraryItem).id, item: item as LibraryItem }));
}

/** 排序键：文件夹用名称 + 聚合时间与建夹时间，与书同列参与排序 */
function sortKey(state: ShelfState, items: LibraryItem[], e: ShelfEntry) {
  if (e.kind === "book") return { title: e.item.title, updated: e.item.updatedAt || 0, created: e.item.createdAt || 0 };
  const agg = folderAggregate(items, e.folder);
  return { title: e.folder.name, updated: agg.latest, created: Date.parse(e.folder.created) || 0 };
}

export function sortEntries(
  state: ShelfState,
  items: LibraryItem[],
  entries: ShelfEntry[],
  sort: ShelfSort
): ShelfEntry[] {
  if (sort === "manual") return entries;
  const key = (e: ShelfEntry) => sortKey(state, items, e);
  const list = [...entries];
  if (sort === "recent") return list.sort((a, b) => key(b).updated - key(a).updated);
  if (sort === "added") return list.sort((a, b) => key(b).created - key(a).created);
  return list.sort((a, b) => key(a).title.localeCompare(key(b).title, "zh"));
}

/* ------------------------------------------------------------ 数组与变更 */

const without = (arr: string[], id: string) => arr.filter((x) => x !== id);

/** 把 id 移到 target 所在的位置（splice-insert 语义，与仪表盘 reorder 一致） */
export function moveTo(arr: string[], id: string, targetId: string): string[] {
  if (id === targetId) return arr;
  const out = [...arr];
  const from = out.indexOf(id);
  if (from < 0) return arr;
  out.splice(from, 1);
  const to = out.indexOf(targetId);
  if (to < 0) return arr;
  out.splice(to, 0, id);
  return out;
}

/** 键盘逐格移动：dir=-1 前移一格，+1 后移一格；到边界原样返回 */
export function moveStep(arr: string[], id: string, dir: -1 | 1): string[] {
  const i = arr.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= arr.length) return arr;
  const out = [...arr];
  out.splice(i, 1);
  out.splice(j, 0, id);
  return out;
}

let seq = 0;
const nextFolderId = (state: ShelfState) => {
  let id = "";
  do {
    id = `f${++seq}`;
  } while (state.folders.some((f) => f.id === id));
  return id;
};
const today = () => new Date().toISOString().slice(0, 10);

/** 当前视图（顶层或某个文件夹内）对应的数组读写口 */
export function currentArray(state: ShelfState, openFolderId: string | null): string[] {
  if (!openFolderId) return state.order;
  return findFolder(state, openFolderId)?.items || [];
}

export function withCurrentArray(
  state: ShelfState,
  openFolderId: string | null,
  next: string[]
): ShelfState {
  if (!openFolderId) return { ...state, order: next };
  const folder = findFolder(state, openFolderId);
  if (!folder) return state;
  return { ...state, folders: state.folders.map((f) => (f === folder ? { ...f, items: next } : f)) };
}

/** 从顶层数组与所有文件夹里同时摘掉一个 id（软删与移动前都要做，否则一处留副本） */
function detach(state: ShelfState, id: string): ShelfState {
  return {
    order: without(state.order, id),
    folders: state.folders.map((f) => ({ ...f, items: without(f.items, id) })),
  };
}

export interface GroupResult {
  state: ShelfState;
  /** 需要就地命名的文件夹 id（新建或已存在都可能需要——默认名「未命名文件夹」不当成结果） */
  renameId: string | null;
  /** 被拒绝时的用户可见原因（如嵌套、同夹） */
  refused?: string;
}

/**
 * 把 source 归入 target：
 * - target 是文件夹 → 直接加入（source 原来在哪个文件夹就搬走）
 * - target 是另一本书 → 新建文件夹 [target, source]，占 target 原来的格子，并请求就地命名
 * 文件夹**不可互相嵌套**（一层为限，指南 §5.4），文件夹内也不建子文件夹。
 */
export function groupInto(state: ShelfState, sourceId: string, targetId: string, openFolderId: string | null): GroupResult {
  if (!sourceId || !targetId || sourceId === targetId) return { state, renameId: null };
  if (isFolderId(sourceId)) return { state, renameId: null, refused: t("暂不支持文件夹互相嵌套（一层为限）") };
  const targetFolder = isFolderId(targetId) ? findFolder(state, targetId) : null;
  if (openFolderId) return { state, renameId: null, refused: t("文件夹内不再嵌套，请先返回书架") };

  if (targetFolder) {
    if (targetFolder.items.includes(sourceId)) return { state, renameId: null };
    const src = folderOf(state, sourceId);
    if (src && src.id === targetFolder.id) return { state, renameId: null };
    const cleared = detach(state, sourceId);
    const folders = cleared.folders.map((f) =>
      f.id === targetFolder.id ? { ...f, items: [...f.items, sourceId] } : f
    );
    // v48.118 / D163：成员只住在 folder.items，**不再写回 order**——
    // 旧版在这里 insertAfter 把 sourceId 留了一份幽灵副本在 order 里，平时被
    // topEntries 的「夹内书不在顶层」过滤遮蔽，解散/全部移出把成员 splice 回 order
    // 时即暴露成第二张卡（用户实测「解散后同名书多出一本」）。
    return { state: { order: cleared.order, folders }, renameId: null };
  }

  const srcFolder = folderOf(state, sourceId);
  const tgtFolder = folderOf(state, targetId);
  if (srcFolder && tgtFolder && srcFolder.id === tgtFolder.id)
    return { state, renameId: null, refused: t("两本书已在同一文件夹里") };
  if (tgtFolder) {
    // 目标已在某文件夹里：等价于把 source 归入那个文件夹（**不做隐式合并**，见 §5.4）
    return groupInto(state, sourceId, tgtFolder.id, null);
  }
  const id = nextFolderId(state);
  const folder: ShelfFolder = { id, name: t(DEFAULT_FOLDER_NAME), items: [targetId, sourceId], created: today() };
  const cleared = detach(state, sourceId);
  const order = cleared.order.map((x) => (x === targetId ? id : x));
  return { state: { order, folders: [...cleared.folders, folder] }, renameId: id };
}

function insertAfter(arr: string[], anchor: string, id: string): string[] {
  const out = without(arr, id);
  const i = out.indexOf(anchor);
  out.splice(i < 0 ? out.length : i + 1, 0, id);
  return out;
}

/** 建一个只放这本书的文件夹（「归入文件夹」菜单里的「新建文件夹并放入」） */
export function createFolderWith(state: ShelfState, bookId: string): { state: ShelfState; folderId: string } {
  const id = nextFolderId(state);
  const folder: ShelfFolder = { id, name: t(DEFAULT_FOLDER_NAME), items: [bookId], created: today() };
  const cleared = detach(state, bookId);
  const at = state.order.indexOf(bookId);
  const order = [...cleared.order];
  order.splice(at < 0 ? order.length : at, 0, id);
  return { state: { order, folders: [...cleared.folders, folder] }, folderId: id };
}

/** 移回书架：放回它原所在文件夹的后面一位（保持"离开但没丢"的位置感） */
export function ungroup(state: ShelfState, bookId: string): ShelfState {
  const folder = folderOf(state, bookId);
  if (!folder) return state;
  const folders = state.folders.map((f) => (f.id === folder.id ? { ...f, items: without(f.items, bookId) } : f));
  return { order: insertAfter(state.order, folder.id, bookId), folders };
}

/** 解散 ≠ 删除：成员回到文件夹原来那一格的位置，一本书都不软删 */
export function dissolveFolder(state: ShelfState, folderId: string): ShelfState {
  const folder = findFolder(state, folderId);
  if (!folder) return state;
  const i = state.order.indexOf(folderId);
  const order = [...state.order];
  // indexOf −1 护栏：splice(-1) 会误换末位条目（v48.118 / D163）
  order.splice(i < 0 ? order.length : i, 1, ...folder.items);
  // v48.118 / D163：落位即去重——历史幽灵副本在解散这一刻就地治愈，不再等下次载入
  return { order: dedupe(order), folders: state.folders.filter((f) => f.id !== folderId) };
}

/** 全部移回书架：空文件夹保留（用户数据不悄悄消失） */
export function moveAllOut(state: ShelfState, folderId: string): ShelfState {
  const folder = findFolder(state, folderId);
  if (!folder || !folder.items.length) return state;
  const i = state.order.indexOf(folderId);
  const order = [...state.order];
  order.splice(i < 0 ? order.length : i + 1, 0, ...folder.items);
  // v48.118 / D163：同 dissolveFolder——落位即去重
  return {
    order: dedupe(order),
    folders: state.folders.map((f) => (f.id === folderId ? { ...f, items: [] } : f)),
  };
}

export function renameFolder(state: ShelfState, folderId: string, name: string): ShelfState {
  const trimmed = name.trim();
  if (!trimmed) return state;
  return { ...state, folders: state.folders.map((f) => (f.id === folderId ? { ...f, name: trimmed } : f)) };
}

/** 删书（软删后从库里消失）时同步摘掉所有引用 */
export function forgetItem(state: ShelfState, id: string): ShelfState {
  if (isFolderId(id)) return { order: without(state.order, id), folders: withoutFolder(state, id) };
  return detach(state, id);
}
const withoutFolder = (state: ShelfState, id: string) => state.folders.filter((f) => f.id !== id);

/* ---------------------------------------------------------------- 展示用 */

export const SHELF_SORTS: { value: ShelfSort; label: string }[] = [
  { value: "manual", label: "手动顺序" },
  { value: "recent", label: "最近阅读" },
  { value: "added", label: "添加时间" },
  { value: "title", label: "标题" },
];

export const SHELF_DENSITIES: { value: ShelfDensity; label: string }[] = [
  { value: "sm", label: "紧凑" },
  { value: "md", label: "标准" },
  { value: "lg", label: "宽松" },
];

export function pct(n: number): string {
  // 批次 D（D-TEST-19）：非有限数按 0 处理。返回值同时用于 CSS 宽度
  // （Bookshelf.tsx 里多处 width: pct(progress)），所以不能返回 "—" 之类的非长度值。
  const x = Number(n);
  return Number.isFinite(x) ? `${Math.round(x * 100)}%` : "0%";
}

/** 'MM-DD'；与既有 lastReadDisplay 的口径一致（书架只到日粒度） */
export function dayLabel(ms: number): string {
  // 批次 D（D-TEST-19）：原来只挡 !ms，Infinity 与 1e18 会穿过并渲染成 "NaN-NaN"。
  // 1e18 是**有限数**但超出 Date 的取值范围（±8.64e15），所以要连 Invalid Date 一起挡。
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
