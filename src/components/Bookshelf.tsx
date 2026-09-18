import { useCallback, useEffect, useState } from "react";
import { libraryApi, lastReadDisplay, BOOK_LANGUAGES, type LibraryItem } from "../lib/library";
import { eventBus } from "../lib/eventbus";

// v45.1（用户反馈「封面偶尔加载失败」）：bookasset 协议注册现已提前（main.js），此处再兜底——
// 启动早期偶发请求失败时自动重试（至多 3 次，400ms 间隔）；仍失败则回落无封面骨架（书脊+标题）。
const COVER_RETRY_MAX = 3;
function CoverImg({ itemId, filename, title }: { itemId: string; filename: string; title: string }) {
  const [attempt, setAttempt] = useState(0);
  if (attempt > COVER_RETRY_MAX) {
    return (
      <>
        <span className="book-card-spine" />
        <p className="book-card-title">{title}</p>
      </>
    );
  }
  return (
    <img
      className="cover-img"
      src={`bookasset://${itemId}/${filename}${attempt > 0 ? `?r=${attempt}` : ""}`}
      alt={title}
      onError={() => window.setTimeout(() => setAttempt((a) => a + 1), 400)}
    />
  );
}

interface Props {
  onOpenBook: (itemId: string) => void;
  /** 添加材料模态（v36）：由 App 级持有——书架入口与全局快捷键 Ctrl+Alt+N 共用同一模态 */
  onAddMaterial: () => void;
}

export default function Bookshelf({ onOpenBook, onAddMaterial }: Props) {
  const [items, setItems] = useState<LibraryItem[]>([]);
  // v45.1：悬停改名——行内编辑（Enter/失焦保存、Esc 取消）
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);

  const refresh = useCallback(async () => {
    setItems(await libraryApi.list());
  }, []);

  useEffect(() => {
    refresh();
    return eventBus.on("library/changed", refresh);
  }, [refresh]);

  async function handleDelete(id: string, title: string) {
    if (!window.confirm(`确定删除《${title}》吗？`)) return;
    await libraryApi.remove(id);
    eventBus.emit("library/changed");
  }

  // v38（D35）：书籍语言属性——查词语言路由的书籍级信号；改完即落库并刷新本地列表
  async function handleSetLang(id: string, lang: string) {
    await libraryApi.setItemLang(id, lang);
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, lang } : it)));
  }

  async function commitRename() {
    const cur = renaming;
    setRenaming(null);
    if (!cur) return;
    const next = cur.value.trim();
    const item = items.find((it) => it.id === cur.id);
    if (!item || !next || next === item.title) return;
    try {
      await libraryApi.setItemTitle(cur.id, next);
      eventBus.emit("library/changed");
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    }
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
          <button className="btn btn-primary" onClick={onAddMaterial}>
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
                  <CoverImg itemId={item.id} filename={item.cover} title={item.title} />
                ) : (
                  <>
                    <span className="book-card-spine" />
                    <p className="book-card-title">{item.title}</p>
                  </>
                )}
              </div>
              <div className="book-card-overlay">
                {renaming?.id === item.id ? (
                  <input
                    className="book-card-rename-input mono"
                    autoFocus
                    value={renaming.value}
                    title="回车保存，Esc 取消"
                    aria-label="修改书名"
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setRenaming({ id: item.id, value: e.target.value })}
                    onBlur={() => void commitRename()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void commitRename();
                      else if (e.key === "Escape") setRenaming(null);
                      e.stopPropagation();
                    }}
                  />
                ) : (
                  <span className="book-card-label">
                    {item.progressJson ? "上次阅读" : "全文开头"}
                  </span>
                )}
                <span className="book-card-text">{lastReadDisplay(item)}</span>
                <select
                  className="book-card-lang mono"
                  title="书籍语言（查词时按它路由词典，D35）"
                  aria-label="书籍语言"
                  value={item.lang ?? ""}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => handleSetLang(item.id, e.target.value)}
                >
                  {BOOK_LANGUAGES.map((l) => (
                    <option key={l.value || "unknown"} value={l.value}>{l.label}</option>
                  ))}
                </select>
                <button
                  className="book-card-rename"
                  title="修改书名"
                  onClick={(e) => {
                    e.stopPropagation();
                    setRenaming({ id: item.id, value: item.title });
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                    <path d="m15 5 4 4" />
                  </svg>
                </button>
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
          <button className="book-add-card" onClick={onAddMaterial}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M5 12h14" />
              <path d="M12 5v14" />
            </svg>
            <span className="book-add-label">添加书籍</span>
          </button>
        </div>
      )}
    </section>
  );
}
