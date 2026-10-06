// v48.60（D101，设计稿 §1.4）：标签输入组件——chips + 建议 + 回车/逗号/顿号确认。
// 规则单一源 = src/lib/tags.ts（normalizeTag/tagKey）；本组件只管交互，不做存储。
// 使用方：手动制卡表单（CardDock 手动态/modal）、浏览器批量打标浮层、卡详情标签区。
import { useMemo, useRef, useState } from "react";
import { IconClose } from "./icons";
import { normalizeTag, tagKey, type TagVocabEntry } from "../lib/tags";

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
  const inputRef = useRef<HTMLInputElement>(null);

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
      return;
    }
    setInvalid(null);
    onChange([...value, r.tag]);
    setText("");
  }

  function remove(tag: string) {
    onChange(value.filter((v) => v !== tag));
    setInvalid(null);
  }

  const showSuggestions = open && filtered.length > 0;

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
      <span className="tag-input-box">
        <input
          ref={inputRef}
          type="text"
          value={text}
          disabled={disabled}
          aria-label={ariaLabel}
          placeholder={placeholder}
          onChange={(e) => {
            setText(e.target.value);
            setInvalid(null);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "，" || e.key === "、" || e.key === ",") {
              e.preventDefault();
              commit(text);
            } else if (e.key === "Backspace" && !text && value.length > 0) {
              onChange(value.slice(0, -1));
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        {showSuggestions && (
          <span className="tag-suggest" role="listbox" aria-label="标签建议">
            {filtered.map((s) => {
              const total = s.cardCount + s.extractCount;
              return (
                <button
                  key={s.display}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onMouseDown={(e) => {
                    // mousedown 抢在 blur 前完成点选（blur 会先收起建议）
                    e.preventDefault();
                    commit(s.display);
                    inputRef.current?.focus();
                  }}
                >
                  {s.display}
                  <span className="mono">{total > 0 ? ` ${total}` : ""}</span>
                </button>
              );
            })}
          </span>
        )}
      </span>
      {invalid && <span className="form-hint tag-invalid">{invalid}</span>}
    </div>
  );
}

export default TagInput;
