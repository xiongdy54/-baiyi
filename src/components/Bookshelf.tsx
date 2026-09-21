import { useCallback, useEffect, useState } from "react";
import { libraryApi, lastReadDisplay, BOOK_LANGUAGES, type LibraryItem } from "../lib/library";
import { eventBus } from "../lib/eventbus";
import { IconAlert, IconPencil, IconPlus, IconTrash } from "./icons";

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
  /** 就地二次确认：记住待确认的那一本，而不是弹原生 confirm（样式不受主题控制，
   * 还会把焦点抢出界面）。同一时刻只允许一张卡处于确认态。 */
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setItems(await libraryApi.list());
  }, []);

  useEffect(() => {
    refresh();
    return eventBus.on("library/changed", refresh);
  }, [refresh]);

  async function confirmDelete(id: string, title: string) {
    setPendingDelete(null);
    setError(null);
    try {
      await libraryApi.remove(id);
      eventBus.emit("library/changed");
    } catch (err) {
      setError(`删除《${title}》失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // v38（D35）：书籍语言属性——查词语言路由的书籍级信号；改完即落库并刷新本地列表
  async function handleSetLang(id: string, lang: string) {
    setError(null);
    try {
      await libraryApi.setItemLang(id, lang);
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, lang } : it)));
    } catch (err) {
      setError(`设置语言失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function commitRename() {
    const cur = renaming;
    setRenaming(null);
    if (!cur) return;
    const next = cur.value.trim();
    const item = items.find((it) => it.id === cur.id);
    if (!item || !next || next === item.title) return;
    setError(null);
    try {
      await libraryApi.setItemTitle(cur.id, next);
      eventBus.emit("library/changed");
    } catch (err) {
      setError(`改名失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <section className="bookshelf">
      <div className="review-count mono">{items.length} 本</div>
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
            <IconPlus />
            添加第一本书
          </button>
        </div>
      ) : (
        <div className="bookshelf-grid">
          {items.map((item) => {
            const confirming = pendingDelete === item.id;
            return (
            <div
              key={item.id}
              className="book-card"
              title={item.title}
              role="button"
              tabIndex={0}
              onClick={() => (confirming ? undefined : onOpenBook(item.id))}
              onKeyDown={(e) => {
                if (e.key === "Escape" && confirming) {
                  setPendingDelete(null);
                  return;
                }
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
              <div className={`book-card-overlay${confirming ? " is-confirming" : ""}`}>
                {confirming ? (
                  <div className="book-card-confirm">
                    <span className="book-card-confirm-title">确定删除《{item.title}》吗？</span>
                    <div className="book-card-confirm-actions">
                      <button className="btn btn-danger btn-sm" onClick={() => void confirmDelete(item.id, item.title)}>
                        确认删除
                      </button>
                      {/* 焦点落在「取消」而不是「确认删除」：进入确认态是点删除钮触发的，
                          把光标停在破坏性按钮上等于让一次误按 Enter 就删书 */}
                      <button className="btn btn-outline btn-sm" autoFocus onClick={() => setPendingDelete(null)}>
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
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
                  </>
                )}
              </div>
              {!confirming && (
                <>
                  <button
                    className="book-card-rename"
                    title="修改书名"
                    aria-label={`修改《${item.title}》的书名`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setRenaming({ id: item.id, value: item.title });
                    }}
                  >
                    <IconPencil />
                  </button>
                  <button
                    className="book-card-delete"
                    title="删除"
                    aria-label={`删除《${item.title}》`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setError(null);
                      setPendingDelete(item.id);
                    }}
                  >
                    <IconTrash />
                  </button>
                </>
              )}
              </div>
            );
          })}
          <button className="book-add-card" onClick={onAddMaterial}>
            <IconPlus size={24} />
            <span className="book-add-label">添加书籍</span>
          </button>
        </div>
      )}
    </section>
  );
}
