// 阅读器侧栏（批 4 Task 15，规格 §5.3）：三页签**目录 / 摘录 / 图谱**，同刻只显示一个面板。
// 由 TocSidebar 升级而来（页签行 .tabs：当前项 accent 下划线，与 Zotero 侧栏同规）。
// 「图谱」页签：无已发布导图时**不渲染**（规格 §5.3 明写）；节点行＝标题 + 层级缩进 + 占比条，
// 区间一律来自主进程（只消费不切分，见 src/lib/reader/mapTree.ts）。
import type { ReaderTocItem } from "../../lib/reader/service";
import { IconClose } from "../icons";
import type { MapTreeItem } from "../../lib/reader/mapTree";

export type ReaderTab = "toc" | "extracts" | "map";

interface FlatItem {
  item: ReaderTocItem;
  level: number;
}

function flatten(items: ReaderTocItem[], level = 0, out: FlatItem[] = []): FlatItem[] {
  for (const item of items) {
    out.push({ item, level });
    if (item.subitems?.length) flatten(item.subitems, level + 1, out);
  }
  return out;
}

export interface ReaderSidebarProps {
  tocItems: ReaderTocItem[];
  activeHref?: string;
  onNavigate: (item: ReaderTocItem) => void;
  onClose: () => void;
  /** 当前页签（会话内记忆，由宿主持有） */
  tab: ReaderTab;
  onTabChange: (t: ReaderTab) => void;
  /** 摘录面板（宿主渲染的节点；缺省＝不渲染该页签） */
  extractsPanel?: React.ReactNode;
  /** 图谱目录（null＝无导图 ⇒ **不渲染**「图谱」页签） */
  mapItems?: MapTreeItem[] | null;
  mapUnitCount?: number;
  onMapNavigate?: (item: MapTreeItem) => void;
  /** 图谱页签是否**可用**（无图则整个页签不出现） */
  mapAvailable?: boolean;
}

export default function ReaderSidebar({
  tocItems,
  activeHref,
  onNavigate,
  onClose,
  tab,
  onTabChange,
  extractsPanel,
  mapItems,
  mapUnitCount = 0,
  onMapNavigate,
  mapAvailable = false
}: ReaderSidebarProps) {
  const flat = flatten(tocItems);
  // D2：每个页签按**自己的数据**在场——目录也照此（PDF 无大纲、EPUB 无 nav 时没有目录页签）；
  // 不是禁用，是不出现（规格 §5.3 对图谱页签的口径，本轮推广到三枚）
  const tabs: Array<[ReaderTab, string]> = [
    ...(flat.length > 0 ? ([["toc", "目录"]] as Array<[ReaderTab, string]>) : []),
    ...(extractsPanel ? ([["extracts", "摘录"]] as Array<[ReaderTab, string]>) : []),
    ...(mapAvailable ? ([["map", "图谱"]] as Array<[ReaderTab, string]>) : [])
  ];
  // 会话记忆的页签此刻不在场时，落到**第一个在场**的页签（不是硬回目录）
  const shown = tabs.some(([id]) => id === tab) ? tab : (tabs[0]?.[0] ?? "toc");

  return (
    <nav className="reader-sidebar" id="reader-sidebar" aria-label="阅读器侧栏" data-reader-sidebar>
      <div className="tabs" role="tablist" data-sidebar-tabs>
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            className={shown === id ? "on" : undefined}
            aria-selected={shown === id}
            data-sidebar-tab={id}
            onClick={() => onTabChange(id)}
          >
            {label}
          </button>
        ))}
        <button className="icon-btn reader-sidebar-close" title="关闭侧栏" aria-label="关闭侧栏" onClick={onClose}>
          <IconClose />
        </button>
      </div>

      {shown === "toc" && (
        <div className="reader-toc-list" data-panel="toc">
          {flat.length === 0 && <p className="reader-toc-empty">本书没有目录数据。</p>}
          {flat.map(({ item, level }, i) => (
            <button
              key={`${item.href}-${i}`}
              className={`reader-toc-item${item.href && item.href === activeHref ? " active" : ""}`}
              style={{ paddingLeft: `calc(var(--sp-3) + ${level} * var(--sp-4))` }}
              onClick={() => onNavigate(item)}
              title={item.label}
              aria-current={item.href && item.href === activeHref ? "location" : undefined}
            >
              {item.label || "(无标题)"}
            </button>
          ))}
        </div>
      )}

      {shown === "extracts" && (
        <div className="reader-side-panel" data-panel="extracts">
          {extractsPanel}
        </div>
      )}

      {shown === "map" && (
        <div className="reader-toc-list" data-panel="map">
          {(mapItems || []).length === 0 && <p className="reader-toc-empty">图谱暂无可用节点。</p>}
          {(mapItems || []).map((it) => (
            <button
              key={it.id}
              className="map-item"
              data-map-node={it.id}
              style={{ paddingLeft: `calc(var(--sp-3) + ${it.depth} * var(--sp-4))` }}
              onClick={() => onMapNavigate?.(it)}
              title={`${it.label}（区间 ${it.start}–${it.end}）`}
            >
              <span className="map-item-label">{it.label}</span>
              {mapUnitCount > 0 && it.end > it.start && (
                <span
                  className="map-bar"
                  data-map-bar
                  aria-hidden="true"
                  style={{ width: `${Math.max(2, Math.round(((it.end - it.start) / mapUnitCount) * 100))}%` }}
                />
              )}
            </button>
          ))}
        </div>
      )}
    </nav>
  );
}
