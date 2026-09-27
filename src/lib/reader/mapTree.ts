// 图谱目录（批 4 Task 15，规格 §5.3「图谱页签」）：把已发布导图的结构树 + 节点区间
// 读成侧栏可用的一行行目录。
//
// **纪律（规格 §8 / Task 15）**：本模块**只消费、不切分**——区间一律来自主进程
// `mapTree`（内部走 `mindmapCore.buildExtractionModel`，与生成/深挖同一份实现面）。
// 渲染层不复制任何区间算法（复制＝两份漂移，先例见 §4「动作栈唯一编排面」）。
import { settingsStore } from "../settings";

export interface MapTreeItem {
  id: string;
  label: string;
  /** 自有区间（提取单元下标，[start,end)）——父节点扣掉子节点后的净区间 */
  start: number;
  end: number;
  depth: number;
}

export interface MapTree {
  title: string;
  items: MapTreeItem[];
}

interface MapTreeApi {
  mapTree?: (documentId: string) => Promise<MapTree | null>;
}

/** 读当前文档的图谱目录；无导图/失败一律 null（侧栏据此**不渲染**「图谱」页签） */
export async function mapTree(documentId: string): Promise<MapTree | null> {
  if (!documentId) return null;
  try {
    const api = (window as unknown as { mindmapAPI?: MapTreeApi }).mindmapAPI;
    const r = await api?.mapTree?.(documentId);
    if (!r || !Array.isArray(r.items) || r.items.length === 0) return null;
    return r;
  } catch {
    return null;
  }
}

/** 节点点击 → 跳该节点自有区间起点（复用既有导图跳转所需的最小信息） */
export function firstUnitOf(item: MapTreeItem): number {
  return Math.max(0, Math.floor(item.start));
}

/** 侧栏用：阅读器设置里记着的页签（会话内记忆；不新增设置键——与 §5.3 排序同规） */
export const READER_TAB_KEY = "readerSidebarTab";
export async function readReaderTab(): Promise<"toc" | "extracts" | "map"> {
  const v = await settingsStore.get<string>("app", READER_TAB_KEY, "toc");
  return v === "extracts" || v === "map" ? v : "toc";
}
