// v48.60（D101，设计稿 §1.4）：标签输入组件——chips + 建议 + 回车/逗号/顿号确认。
// 规则单一源 = src/lib/tags.ts（normalizeTag/tagKey）；本组件只管交互，不做存储。
// 使用方：手动制卡表单（CardDock 手动态/modal）、浏览器批量打标浮层、卡详情标签区、
//         复习页快捷打标、筛选牌组条件构建器（D105）。
// v48.62（D106，设计稿 docs/design/TAG-SUGGESTION-PREVIEW.md V4 定稿）：建议改**展开式面板**——
// 输入 ≥1 字即向下生长为一体化面板（同底色 + accent 连续描边；候选 ≤8 或「回车新建」提示行）；
// **首项不预选**：Enter 恒为确认输入原文（回车新建语义不变），↑↓ 显式激活候选后才接管 Enter；
// 候选两行结构（层级路径 + 两源计数 meta），输入前缀 accent 高亮（staging：让「为什么推荐它」可见）；
// 动效映射既有 D88 Token：展开 200ms ease-in-out（state-changes accordion）、收回 140ms（closing 态去回对称）、
// 行 stagger 20ms 上限 5（entrance-animations）；聚焦态 border accent（既有 :focus 规则）＝Anticipation 预告步。
import { useMemo, useRef, useState } from "react";
import { IconClose } from "./icons";
import { normalizeTag, tagKey, type TagVocabEntry } from "../lib/tags";

/** 收回动效时长（theme.css tag-panel-shrink 同步；ms） */
const CLOSE_MS = 140;

/** 前缀高亮切分：按 tagKey 折叠串定位；NFKC 展开导致长度不一致的罕见词不高亮（如实降级） */
function splitPrefix(display: string, query: string): [string, string] | null {
  const q = query.trim();
  if (!q) return null;
  const k = tagKey(display);
  const qk = tagKey(q);
  if (!qk) return null;
  const idx = k.indexOf(qk);
  if (idx < 0) return null;
  if ([...k].length !== [...display].length) return null;
  const start = [...k].slice(0, idx).length;
  const end = start + [...qk].length;
  return [display.slice(0, end), display.slice(end)];
}

export function TagInput({
  value,
  onChange,
  suggestions,
  placeholder = "输入标签，回车确认",
  ariaLabel = "标签",
  disabled = false
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  /** 词表建议（cards:listTags）；无词表时不显示建议 */
  suggestions?: TagVocabEntry[] | null;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const [invalid, setInvalid] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  /** D106：收回动效态（closing 期间面板仍在 DOM，播 140ms 收回后卸载） */
  const [closing, setClosing] = useState(false);
  /** D106：↑↓ 显式激活的候选下标（-1 = 未激活——Enter 走「确认输入原文」） */
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeTimer = useRef<number | null>(null);

  const filtered = useMemo(() => {
    if (!suggestions || !text.trim()) return [];
    const key = tagKey(text.trim());
    return suggestions
      .filter((s) => {
        const k = tagKey(s.display);
        if (k.includes(key) && !value.some((v) => tagKey(v) === k)) return true;
        // 层级前缀建议：输入「考研」时也提示「考研::英语」
        return k.startsWith(key + "::") && !value.some((v) => tagKey(v) === k);
      })
      .slice(0, 8);
  }, [suggestions, text, value]);

  // D106 打开条件：输入 ≥1 字（候选或「回车新建」提示行）；纯聚焦不展开
  const panelVisible = !disabled && open && !closing && text.trim().length > 0;
  const panelMounted = panelVisible || (closing && open);

  function clearCloseTimer() {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }
  /** D106 收回：播 140ms 收回动效后卸载（去回对称；Esc/失焦共用） */
  function startClose() {
    if (!panelVisible && !closing) {
      setOpen(false);
      return;
    }
    setClosing(true);
    clearCloseTimer();
    closeTimer.current = window.setTimeout(() => {
      setClosing(false);
      setOpen(false);
      setActive(-1);
      closeTimer.current = null;
    }, CLOSE_MS);
  }

  function commit(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const r = normalizeTag(trimmed);
    if (!r.ok) {
      setInvalid(r.reason);
      return;
    }
    if (value.some((v) => tagKey(v) === tagKey(r.tag))) {
      setInvalid("已有相同标签");
      setText("");
      setActive(-1);
      return;
    }
    setInvalid(null);
    onChange([...value, r.tag]);
    setText("");
    setActive(-1);
  }

  function remove(tag: string) {
    onChange(value.filter((v) => v !== tag));
    setInvalid(null);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === "，" || e.key === "、" || e.key === ",") {
      e.preventDefault();
      // D106：↑↓ 显式激活的候选接管 Enter；未激活时 Enter = 确认输入原文（首项不预选）
      if (panelVisible && active >= 0 && filtered[active]) commit(filtered[active].display);
      else commit(text);
    } else if (e.key === "ArrowDown" && panelVisible && filtered.length > 0) {
      e.preventDefault();
      setActive((a) => (a + 1) % filtered.length);
    } else if (e.key === "ArrowUp" && panelVisible && filtered.length > 0) {
      e.preventDefault();
      setActive((a) => (a <= 0 ? filtered.length - 1 : a - 1));
    } else if (e.key === "Backspace" && !text && value.length > 0) {
      onChange(value.slice(0, -1));
    } else if (e.key === "Escape") {
      startClose();
    }
  }

  return (
    <div className="tag-input" data-testid="tag-input">
      {value.length > 0 && (
        <span className="tag-chips">
          {value.map((t) => (
            <button key={t} type="button" className="tag-chip" title="点击移除" disabled={disabled} onClick={() => remove(t)}>
              {t}
              <IconClose size={12} />
            </button>
          ))}
        </span>
      )}
      <span className={`tag-input-box${panelMounted ? " expanded" : ""}`}>
        <input
          ref={inputRef}
          type="text"
          value={text}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-expanded={panelMounted}
          placeholder={placeholder}
          onChange={(e) => {
            clearCloseTimer();
            setClosing(false);
            setText(e.target.value);
            setInvalid(null);
            setActive(-1);
            setOpen(true);
          }}
          onFocus={() => {
            clearCloseTimer();
            setClosing(false);
            setOpen(true);
          }}
          onBlur={() => startClose()}
          onKeyDown={onKeyDown}
        />
        {panelMounted && (
          <span
            className={`tag-suggest tag-suggest-v4${closing ? " closing" : ""}`}
            role="listbox"
            aria-label="标签建议"
          >
            <span className="tag-suggest-clip">
              <span className="tag-suggest-body">
                {filtered.length === 0 ? (
                  <span className="tag-suggest-empty" data-testid="tag-suggest-empty">
                    回车新建「{text.trim()}」
                  </span>
                ) : (
                  filtered.map((s, i) => {
                    const parts = splitPrefix(s.display, text);
                    const meta = [
                      s.cardCount > 0 ? `卡 ${s.cardCount}` : "",
                      s.extractCount > 0 ? `批注 ${s.extractCount}` : ""
                    ].filter(Boolean).join(" · ");
                    return (
                      <button
                        key={s.display}
                        type="button"
                        role="option"
                        aria-selected={i === active}
                        className={`tag-suggest-row${i === active ? " active" : ""}`}
                        style={{ animationDelay: `${Math.min(i, 4) * 20}ms` }}
                        onMouseDown={(e) => {
                          // mousedown 抢在 blur 前完成点选（blur 会先收回面板）
                          e.preventDefault();
                          commit(s.display);
                          inputRef.current?.focus();
                        }}
                      >
                        <span className="tag-suggest-path">
                          {parts ? (
                            <>
                              <span className="tag-suggest-hit">{parts[0]}</span>
                              {parts[1]}
                            </>
                          ) : (
                            s.display
                          )}
                        </span>
                        {meta && <span className="tag-suggest-meta mono">{meta}</span>}
                      </button>
                    );
                  })
                )}
              </span>
            </span>
          </span>
        )}
      </span>
      {invalid && <span className="form-hint tag-invalid">{invalid}</span>}
    </div>
  );
}

export default TagInput;
