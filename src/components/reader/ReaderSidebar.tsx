// 阅读器侧栏（批 4 Task 15，规格 §5.3 / §6.8-13）：三页签**目录 / 摘录 / 图谱**，同刻只显示一个面板。
// 由 TocSidebar 升级而来（页签行 .tabs：当前项 rail 头同款选中态）。
// v48.44（D84）：① 三页签**恒可点**——D83 的「数据不在场＝disabled」作废（用户：即使没有内容，
// 也应允许点击进入页签，与摘录页侧栏一致）；空数据进页签显示空态文案。② 「图谱」页签＝**导图工作区
// 本体**（MindmapTab 面板经 mapPanel 注入，D84；原 mapTree 树形目录退役，节点跳转由画布选中/搜索承接）。
import type { ReaderTocItem } from "../../lib/reader/service";

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
