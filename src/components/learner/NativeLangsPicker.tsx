// v48.123（D168）：母语多选选单（TracksDialog 与设置页 sec-learner 共用）。
// 原（D124 §11.6 初版）为 46 个语言标签全量平铺，纵向占用过大——改 dd 族多选弹层：
// 触发钮一行收纳已选语言名，弹层内限高滚动勾选 + 末行「其他语言代码」输入（2–3 个字母 ISO 代码，回车添加）。
// 视觉/动效零新词汇：.dd / .dd-btn / .dd-menu / .dd-item 既有语言（pop-in 220ms --spring 存量豁免，§8.4）。
// 弹层用 dd-menu-left 贴触发钮左缘展开——设置页宽档 .settings-content 自滚（overflow-y:auto），
// right:0 对齐会使弹层向左探出滚动容器被裁（LTR 左溢不可滚，D126 R4.2 同源教训）；
// 翻边 dd-menu-up/down 按最近滚动祖先可见盒实测（useLayoutEffect 绘制前落位，无闪烁）。
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { NATIVE_LANG_CHOICES, languageDisplayName } from "../../lib/learner";
import { learnerStrings } from "../../lib/learnerStrings";
import { IconChevronDown } from "../icons";

export default function NativeLangsPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const S = learnerStrings();
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const [custom, setCustom] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Esc 只收选单、不关宿主模态：dialogA11y 在 document capture 层监听 Esc 关模态，
  // 须在更早的 window capture 层拦截（同 SettingsPanel 快捷键捕获先例），stopPropagation 后自行处理
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      btnRef.current?.focus();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  // 弹层挂载后（绘制前）实测翻边：下方放不下且上方放得下才向上开。
  // 判定基准＝最近的 overflow 滚动祖先（设置页宽档 .settings-content 自滚、D126 R4.2 同源裁切面），
  // 兜底 window.innerHeight。
  useLayoutEffect(() => {
    if (!open) return;
    const btn = btnRef.current;
    const menu = menuRef.current;
    if (!btn || !menu) return;
    let clipBottom = window.innerHeight;
    let clipTop = 0;
    for (let el = rootRef.current?.parentElement; el; el = el.parentElement) {
      const ov = getComputedStyle(el).overflowY;
      if (ov === "auto" || ov === "scroll") {
        const r = el.getBoundingClientRect();
        clipBottom = r.bottom;
        clipTop = r.top;
        break;
      }
    }
    const br = btn.getBoundingClientRect();
    const mh = menu.offsetHeight;
    setUp(br.bottom + mh + 4 > clipBottom && br.top - mh - 4 > clipTop);
    // 选单惯例：开单时选中项滚入可视区——offsetTop 纯布局计算（与弹层翻边定位态无关），居中并双向钳制
    const list = menu.querySelector<HTMLDivElement>(".learner-native-list");
    const on = menu.querySelector<HTMLElement>(".dd-item-on");
    if (list && on) {
      const max = list.scrollHeight - list.clientHeight;
      const target = on.offsetTop - (list.clientHeight - on.offsetHeight) / 2;
      list.scrollTop = Math.max(0, Math.min(target, max));
    }
  }, [open]);

  const selected = new Set(value);
  const toggle = (code: string) => {
    const next = selected.has(code) ? value.filter((c) => c !== code) : [...value, code];
    onChange(next.sort((a, b) => a.localeCompare(b)));
  };
  const addCustom = () => {
    const code = custom.trim().toLowerCase();
    if (!/^[a-z]{2,3}$/.test(code) || selected.has(code)) {
      setCustom("");
      return;
    }
    onChange([...value, code].sort((a, b) => a.localeCompare(b)));
    setCustom("");
  };
  // 候选 = NATIVE_LANG_CHOICES + 已添加的自定义代码（弹层内始终可见、可取消选中），统一按显示名排序
  const options = [...new Set([...NATIVE_LANG_CHOICES, ...value])].sort((a, b) =>
    languageDisplayName(a).localeCompare(languageDisplayName(b))
  );
  const summary = value.map((c) => languageDisplayName(c)).join("、");

  return (
    <div className="dd learner-native" ref={rootRef}>
      <button
        type="button"
        ref={btnRef}
        className="dd-btn learner-native-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={summary || undefined}
        onClick={() => setOpen(!open)}
      >
        <span className={`learner-native-summary${value.length === 0 ? " is-empty" : ""}`}>
          {summary || S.tracks.nativePlaceholder}
        </span>
        <IconChevronDown size={12} className="dd-caret" />
      </button>
      {open && (
        <div
          ref={menuRef}
          className={`dd-menu dd-menu-left learner-native-menu dd-menu-${up ? "up" : "down"}`}
          role="listbox"
          aria-multiselectable="true"
        >
          <div className="learner-native-list">
            {options.map((code) => {
              const on = selected.has(code);
              return (
                <button
                  key={code}
                  type="button"
                  role="option"
                  aria-selected={on}
                  className={`dd-item${on ? " dd-item-on" : ""}`}
                  onClick={() => toggle(code)}
                >
                  {languageDisplayName(code)}
                </button>
              );
            })}
          </div>
          <div className="learner-native-custom">
            <input
              value={custom}
              placeholder={S.tracks.otherLangPlaceholder}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCustom();
                }
              }}
            />
            <button type="button" className="btn btn-secondary btn-sm" onClick={addCustom}>
              {S.tracks.add}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
