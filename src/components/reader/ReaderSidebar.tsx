// 阅读器侧栏（批 4 Task 15，规格 §5.3）：三页签**目录 / 摘录 / 图谱**，同刻只显示一个面板。
// 由 TocSidebar 升级而来（页签行 .tabs：当前项 accent 下划线，与 Zotero 侧栏同规）。
// 「图谱」页签：无已发布导图时**不渲染**（规格 §5.3 明写）；节点行＝标题 + 区间文字 + 层级缩进（D4 起不再画占比条），
// 区间一律来自主进程（只消费不切分，见 src/lib/reader/mapTree.ts）。
import type { ReaderTocItem } from "../../lib/reader/service";
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
  /** 当前页签（会话记忆，由宿主持有） */
  tab: ReaderTab;
  onTabChange: (t: ReaderTab) => void;
  /** 摘录面板（宿主渲染的节点；缺省＝该页签**禁用**（v48.43/D83 页签恒在，不再消失） */
  extractsPanel?: React.ReactNode;
  /** 图谱目录（null＝无导图 ⇒ 「图谱」页签禁用） */
  mapItems?: MapTreeItem[] | null;
  onMapNavigate?: (item: MapTreeItem) => void;
  /** 图谱页签是否**可用**（无图则页签禁用不消失） */
  mapAvailable?: boolean;
}

export default function ReaderSidebar({
  tocItems,
  activeHref,
  onNavigate,
  tab,
  onTabChange,
  extractsPanel,
  mapItems,
  onMapNavigate,
  mapAvailable = false
}: ReaderSidebarProps) {
  const flat = flatten(tocItems);
  // D2：页签按数据在场——v48.43（D83）改口径：三枚**恒在**（用户：不知道为什么有时只剩一两枚），
  // 数据不在场＝disabled + title 说明；不是删除。行样式对齐摘录页批注栏头（24 高/meta/选中 grey-1 底）。
  const tabs: Array<[ReaderTab, string, boolean]> = [
    ["toc", "目录", flat.length > 0],
    ["extracts", "摘录", Boolean(extractsPanel)],
    ["map", "图谱", Boolean(mapAvailable)]
  ];
  // 会话记忆的页签此刻不可用时，落到**第一个可用**页签（不是硬回目录）
  const shown = tabs.some(([id, , ok]) => ok && id === tab) ? tab : (tabs.find(([, , ok]) => ok)?.[0] ?? "toc");

  return (
    <nav className="reader-sidebar" id="reader-sidebar" aria-label="阅读器侧栏" data-reader-sidebar>
      <div className="tabs" role="tablist" data-sidebar-tabs>
        {tabs.map(([id, label, ok]) => (
          <button
            key={id}
            type="button"
            role="tab"
            className={shown === id ? "on" : undefined}
            aria-selected={shown === id}
            aria-disabled={!ok}
            data-sidebar-tab={id}
            title={ok ? undefined : "本书暂无此页签数据"}
            onClick={() => ok && onTabChange(id)}
          >
            {label}
          </button>
        ))}
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
              data-map-start={it.start}
              data-map-end={it.end}
              data-map-depth={it.depth}
              style={{ paddingLeft: `calc(var(--sp-3) + ${it.depth} * var(--sp-4))` }}
              onClick={() => onMapNavigate?.(it)}
              title={`${it.label}（单元 ${it.start}–${it.end}，L${it.depth}）`}
            >
              {/* D4：只出「节点 + 区间 + 层级」文字，**不画占比条**（用户明确：占比条不好看）。
                  区间口径＝主进程给的净区间（父扣掉子），与样张行里的「单元 start–end」同形。 */}
              <span className="map-item-label">{it.label}</span>
              <span className="map-item-meta mono">
                <span className="map-item-range" data-map-range>{`单元 ${it.start}–${it.end}`}</span>
                <span className="map-item-level" data-map-level>{`L${it.depth}`}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </nav>
  );
}
