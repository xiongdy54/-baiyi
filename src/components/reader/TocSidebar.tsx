// 目录侧栏（v20）：共享壳层组件——数据可来自引擎 book.toc，未来摘录/粘贴书同构。
// 瑞士风：paper 底 + hairline 右缘 + 直角 + 层级缩进 + 当前项 accent 左条。
import type { ReaderTocItem } from "../../lib/reader/service";

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

interface Props {
  items: ReaderTocItem[];
  /** 当前章 href（relocate 提供）；匹配项显示 accent 高亮 */
  activeHref?: string;
  onNavigate: (item: ReaderTocItem) => void;
  onClose: () => void;
}

export default function TocSidebar({ items, activeHref, onNavigate, onClose }: Props) {
  const flat = flatten(items);
  return (
    <div className="reader-toc">
      <div className="reader-toc-head">
        <span className="reader-toc-title">目录</span>
        <button className="icon-btn" title="关闭目录" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>
      <div className="reader-toc-list">
        {flat.length === 0 && <p className="reader-toc-empty">本书没有目录数据。</p>}
        {flat.map(({ item, level }, i) => (
          <button
            key={`${item.href}-${i}`}
            className={`reader-toc-item${item.href && item.href === activeHref ? " active" : ""}`}
            style={{ paddingLeft: `calc(var(--sp-3) + ${level} * var(--sp-4))` }}
            onClick={() => onNavigate(item)}
            title={item.label}
          >
            {item.label || "(无标题)"}
          </button>
        ))}
      </div>
    </div>
  );
}
