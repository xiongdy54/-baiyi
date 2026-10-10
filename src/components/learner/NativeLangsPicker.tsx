// v48.80（D124 / 设计稿 §11.4）：母语多选控件（TracksDialog 与设置页 sec-learner 共用）。
// 候选 = NATIVE_LANG_CHOICES + 末尾「其他语言代码」输入（2–3 个字母 ISO 代码，回车添加）。
import { useState } from "react";
import { NATIVE_LANG_CHOICES, languageDisplayName } from "../../lib/learner";
import { learnerStrings } from "../../lib/learnerStrings";

export default function NativeLangsPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const S = learnerStrings();
  const [custom, setCustom] = useState("");
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
  const options = [...NATIVE_LANG_CHOICES].sort((a, b) => languageDisplayName(a).localeCompare(languageDisplayName(b)));
  return (
    <div className="learner-native-picker">
      <div className="learner-native-list">
        {options.map((code) => (
          <button
            key={code}
            type="button"
            className={`learner-tag${selected.has(code) ? " is-on" : ""}`}
            aria-pressed={selected.has(code)}
            onClick={() => toggle(code)}
          >
            {languageDisplayName(code)}
          </button>
        ))}
        {[...value]
          .filter((c) => !NATIVE_LANG_CHOICES.includes(c))
          .sort()
          .map((code) => (
            <button key={code} type="button" className="learner-tag is-on" aria-pressed onClick={() => toggle(code)}>
              {languageDisplayName(code)}
            </button>
          ))}
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
  );
}
