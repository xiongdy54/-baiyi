// 阅读器侧栏（批 4 Task 15，规格 §5.3 / §6.8-13）：**全高左轨**（v48.45/D85，与摘录批注轨同一形态）。
// 结构＝栏头行（v48.45/D85：与摘录页 `.annot-side-head` 同几何——「全部/摘录/高亮」筛选 +
// 「位置/时间」排序，挂在「收起/展开」钮旁）+ 三页签**目录 / 摘录 / 图谱** + 当前页签面板。
// v48.44（D84）：三页签**恒可点**（空数据进页签显示空态文案）；「图谱」页签＝导图工作区面板
// （MindmapTab 经 mapPanel 注入；原 mapTree 树形目录退役）。
import type { ReaderTocItem } from "../../lib/reader/service";
import type { AnnotFilter, AnnotSort } from "./AnnotationPanel";

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
  /** 栏头段控：注解筛选（持久键 app.annotationFilter，宿主持有） */
  filter: AnnotFilter;
  onFilter: (f: AnnotFilter) => void;
  /** 栏头段控：注解排序（会话内视图偏好，宿主持有——与摘录页栏头同一控件） */
  sort: AnnotSort;
  onSort: (s: AnnotSort) => void;
  /** 摘录面板（宿主渲染的节点；null＝空态文案「本书暂无批注。」） */
  extractsPanel?: React.ReactNode;
  /** 图谱页签面板（宿主＝MindmapTab；缺省＝空态文案） */
  mapPanel?: React.ReactNode;
}

export default function ReaderSidebar({
  tocItems,
  activeHref,
  onNavigate,
  tab,
  onTabChange,
  filter,
  onFilter,
  sort,
  onSort,
  extractsPanel,
  mapPanel
}: ReaderSidebarProps) {
  const flat = flatten(tocItems);
  // v48.44（D84）：页签**恒可点**（三枚恒在且都可进，空数据＝页签内空态文案，不 disabled）。
  // 着陆页签＝会话记忆；唯一下探：会话停在「目录」而目录无数据、其他页签有内容时，
  // 落到首个**有内容**的页签（无目录 PDF 开栏直达注解栏——D67 起的着陆行为，保留）。
  const tabs: Array<[ReaderTab, string]> = [
    ["toc", "目录"],
    ["extracts", "摘录"],
    ["map", "图谱"]
  ];
  const shown =
    tab === "toc" && flat.length === 0 && (extractsPanel || mapPanel)
      ? extractsPanel
        ? "extracts"
        : "map"
      : tab;

  return (
    <nav className="reader-sidebar" id="reader-sidebar" aria-label="阅读器侧栏" data-reader-sidebar>
      {/* v48.45（D85）：栏头行＝摘录页批注栏头同款（类名/几何同一套：.annot-side-head + .filter/.sort）——
          段控挂在「收起/展开」钮旁，对摘录页签里的注解列表生效（面板本体 showHead 防双份）。 */}
      <div className="annot-side-head" data-reader-annot-head>
        <span className="filter" data-annot-filterseg>
          {([["all", "全部"], ["extract", "摘录"], ["highlight", "高亮"]] as const).map(([id, label]) => (
            <button key={id} className={filter === id ? "on" : ""} data-f={id} onClick={() => onFilter(id)}>
              {label}
            </button>
          ))}
        </span>
        <span className="sort" data-annot-sortseg>
          {([["pos", "位置"], ["time", "时间"]] as const).map(([id, label]) => (
            <button key={id} className={sort === id ? "on" : ""} data-sort={id} onClick={() => onSort(id)}>
              {label}
            </button>
          ))}
        </span>
      </div>

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
          {extractsPanel ?? <p className="reader-toc-empty">本书暂无批注。</p>}
        </div>
      )}

      {shown === "map" && (
        <div className="reader-side-panel reader-map-panel" data-panel="map">
          {mapPanel ?? <p className="reader-toc-empty">图谱页签暂不可用。</p>}
        </div>
      )}
    </nav>
  );
}
