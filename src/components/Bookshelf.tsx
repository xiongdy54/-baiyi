import { useCallback, useEffect, useState } from "react";
import { libraryApi, lastReadDisplay, type LibraryItem } from "../lib/library";
import { eventBus } from "../lib/eventbus";
import AddBookModal from "./AddBookModal";

interface Props {
  onOpenBook: (itemId: string) => void;
}

export default function Bookshelf({ onOpenBook }: Props) {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [addOpen, setAddOpen] = useState(false);

  const refresh = useCallback(async () => {
    setItems(await libraryApi.list());
  }, []);

  useEffect(() => {
    refresh();
    return eventBus.on("library/changed", refresh);
  }, [refresh]);

  async function handleSave(title: string, markdown: string) {
    await libraryApi.createFromPaste(title, markdown);
    eventBus.emit("library/changed");
    setAddOpen(false);
  }

  async function handleDelete(id: string, title: string) {
    if (!window.confirm(`确定删除《${title}》吗？`)) return;
    await libraryApi.remove(id);
    eventBus.emit("library/changed");
  }

  return (
    <section className="bookshelf">
      <div className="review-count mono">{items.length} 本</div>
      {items.length === 0 ? (
        <div className="empty-state">
          <div className="empty-deco">
            <span className="empty-sq empty-sq-accent" />
            <span className="empty-sq" />
            <span className="empty-sq" />
          </div>
          <p className="empty-text">
            书架还是空的。粘贴一段文本，或导入 EPUB / Word / TXT / Markdown 文件，开始你的渐进阅读。
          </p>
          <button className="btn btn-primary" onClick={() => setAddOpen(true)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M5 12h14" />
              <path d="M12 5v14" />
            </svg>
            添加第一本书
          </button>
        </div>
      ) : (
        <div className="bookshelf-grid">
          {items.map((item) => (
            <div
              key={item.id}
              className="book-card"
              title={item.title}
              role="button"
              tabIndex={0}
              onClick={() => onOpenBook(item.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") onOpenBook(item.id);
              }}
            >
              <div className="book-card-cover">
                {item.cover ? (
                  <img
                    className="cover-img"
                    src={`bookasset://${item.id}/${item.cover}`}
                    alt={item.title}
                  />
                ) : (
                  <>
                    <span className="book-card-spine" />
                    <p className="book-card-title">{item.title}</p>
                  </>
                )}
              </div>
              <div className="book-card-overlay">
                <span className="book-card-label">
                  {item.progressJson ? "上次阅读" : "全文开头"}
                </span>
                <span className="book-card-text">{lastReadDisplay(item)}</span>
                <button
                  className="book-card-delete"
                  title="删除"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(item.id, item.title);
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    <line x1="10" x2="10" y1="11" y2="17" />
                    <line x1="14" x2="14" y1="11" y2="17" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
          <button className="book-add-card" onClick={() => setAddOpen(true)}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M5 12h14" />
              <path d="M12 5v14" />
            </svg>
            <span className="book-add-label">添加书籍</span>
          </button>
        </div>
      )}
      {addOpen && <AddBookModal onSave={handleSave} onClose={() => setAddOpen(false)} />}
    </section>
  );
}
