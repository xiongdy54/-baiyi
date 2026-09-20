// M7 单词弹窗 DictPanel（v32，D31）——阅读辅助优先，非完整词典页。
// 默认层级：[拼写]→[音标+播放]→[1–2 条释义]→[一键制卡]→来源徽标；其余字段按 popupFields + capabilities 显隐。
// 异步三态：原文即显→Loading→填充/错误（重试/切本地），在线绝不阻塞阅读器。
import { useEffect, useState } from "react";
import type { DictionaryEntry, ReadingContext, VocabKind } from "../lib/dict";
import { VOCAB_KINDS, VOCAB_KIND_LABEL } from "../lib/dict";
import { DEFAULT_POPUP_FIELDS, loadVocabKinds, playAudioUrl, saveVocabKinds, speakText } from "../lib/dictClient";
import { IconVolume } from "./icons";

export interface DictPanelState {
  selectedText: string;
  sentence: string;
  running: boolean;
  error?: string | null;
  entry?: DictionaryEntry | null;
  providerId?: string | null;
  fromCache?: boolean;
  mode?: string;
}

// v38（D35）：语言切换 chips（自动 + 常用四语；更多语言走书籍语言属性）
const DICT_LANG_CHIPS: { value: string; label: string }[] = [
  { value: "auto", label: "自动" },
  { value: "en", label: "英语" },
  { value: "ja", label: "日语" },
  { value: "zh", label: "中文" },
  { value: "ko", label: "韩语" },
];

const FIELD_LABELS: { key: string; label: string }[] = [
  { key: "spelling", label: "拼写" },
  { key: "pronunciation", label: "音标" },
  { key: "audio", label: "发音" },
  { key: "definition", label: "释义" },
  { key: "partOfSpeech", label: "词性" },
  { key: "examples", label: "例句" },
  { key: "synonyms", label: "同义词" },
  { key: "antonyms", label: "反义词" },
  { key: "etymology", label: "词源" },
];

export function DictPanel({
  panel,
  reading,
  popupFields,
  manualLang,
  onClose,
  onRetry,
  onUseLocal,
  onSelectLanguage,
  onMakeCards,
}: {
  panel: DictPanelState;
  reading: ReadingContext | null;
  popupFields: Record<string, boolean>;
  /** v38（D35）：当前手动语言（null=自动路由） */
  manualLang?: string | null;
  onClose: () => void;
  onRetry: () => void;
  onUseLocal: () => void;
  /** v38（D35）：语言切换重查（"auto"=清除手动选择） */
  onSelectLanguage: (lang: string) => void;
  onMakeCards: (entry: DictionaryEntry, ctx: ReadingContext, kinds: VocabKind[]) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  // 查词失败时列出已装词典——帮用户分辨「在线挂了/没装对应语言的词典」
  // （CC-CEDICT 头词是中文，英文词查不到属预期，需装 ECDICT——2026-09-14 用户实测反馈）
  const [installed, setInstalled] = useState<{ name: string; format: string; entry_count: number }[]>([]);
  useEffect(() => {
    if (!panel.error) return;
    void window.dictAPI?.sources().then((s) => {
      const list = (s as { name: string; format: string; entry_count: number; enabled: number }[] | undefined) ?? [];
      setInstalled(list.filter((x) => x.enabled));
    }).catch(() => {});
  }, [panel.error]);
  const fields = { ...DEFAULT_POPUP_FIELDS, ...(popupFields || {}) };
  const entry = panel.entry ?? null;
  // 单词卡四形式勾选（v32）：按语言记忆——entry 语言变化时读入上次勾选，toggle 即落盘
  const [kinds, setKinds] = useState<VocabKind[]>(VOCAB_KINDS);
  useEffect(() => {
    let cancelled = false;
    void loadVocabKinds(entry?.language ?? "").then((k) => {
      if (!cancelled) setKinds(k);
    });
    return () => {
      cancelled = true;
    };
  }, [entry?.language]);
  function toggleKind(k: VocabKind) {
    setKinds((prev) => {
      const next = prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k];
      void saveVocabKinds(entry?.language ?? "", next);
      return next;
    });
  }
  const caps = new Set(entry?.capabilities ?? []);
  const can = (c: string) => caps.size === 0 || caps.has(c as never);

  const speak = () => {
    if (!entry) return;
    if (entry.audio) playAudioUrl(entry.audio);
    else speakText(entry.word);
  };

  return (
    <div className="ai-panel dict-panel">
      <div className="ai-panel-head">
        <span className="ai-panel-title">查词{panel.fromCache ? "（缓存）" : ""}</span>
        <button className="icon-btn" title="关闭" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>
      <div className="ai-panel-body">
        <blockquote className="ai-quote">{panel.selectedText}</blockquote>
        {/* v38（D35）：语言切换 chips——纯汉字串消歧的最终兜底（自动路由错时一键改语言重查） */}
        <div className="dict-lang-row" role="group" aria-label="查词语言">
          {DICT_LANG_CHIPS.map((chip) => {
            const active = chip.value === "auto" ? !manualLang : manualLang === chip.value;
            return (
              <button
                key={chip.value}
                className={`dict-lang-chip${active ? " active" : ""}`}
                title={chip.value === "auto" ? "自动：按词内/句子/书籍语言识别" : `以${chip.label}查词`}
                onClick={() => onSelectLanguage(chip.value)}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
        {panel.running && <div className="ai-streaming mono">正在查询…（在线失败可重试或切本地，不阻塞阅读）</div>}
        {panel.error && !panel.running && (
          <div className="ai-error">
            {panel.error}
            {installed.length > 0 && (
              <div className="dict-meta" style={{ marginTop: 6 }}>
                已装词典：{installed.map((s) => `${s.name}（${s.entry_count} 词条）`).join("、")}
                {installed.every((s) => s.format.startsWith("cedict")) && " —— CC-CEDICT 是中→英词典（头词为中文），查英文单词请安装 ECDICT 完整版"}
              </div>
            )}
            {installed.length === 0 && (
              <div className="dict-meta" style={{ marginTop: 6 }}>尚未安装任何本地词典——设置 → 词典/下载 一键安装。</div>
            )}
            <div className="ai-actions" style={{ marginTop: 8 }}>
              <button className="btn btn-outline btn-sm" onClick={onRetry}>重试</button>
              <button className="btn btn-outline btn-sm" onClick={onUseLocal}>使用本地词典</button>
            </div>
          </div>
        )}
        {entry && (
          <>
            {fields.spelling && <div className="dict-word">{entry.word}{entry.reading && entry.reading !== entry.word ? `（${entry.reading}）` : ""}</div>}
            <div className="dict-pron-row">
              {fields.pronunciation && entry.pronunciation && can("pronunciation") && (
                <span className="dict-phon mono">{entry.pronunciation}</span>
              )}
              {fields.audio && can("audio") && (
                <button className="btn btn-outline btn-sm" title="播放发音" aria-label="播放发音" onClick={speak}><IconVolume /></button>
              )}
            </div>
            {fields.definition && (
              <div className="dict-defs">
                {entry.definitions.slice(0, showAll ? 6 : 2).map((d, i) => (
                  <div key={i} className="dict-def">{i + 1}. {d}</div>
                ))}
              </div>
            )}
            {fields.partOfSpeech && entry.partOfSpeech?.length && can("partOfSpeech") ? (
              <div className="dict-meta">词性：{entry.partOfSpeech.join(" / ")}</div>
            ) : null}
            {fields.examples && entry.examples?.length && can("examples") ? (
              <div className="dict-meta">例句：{entry.examples.slice(0, 2).join(" ／ ")}</div>
            ) : null}
            {fields.synonyms && entry.synonyms?.length && can("synonyms") ? (
              <div className="dict-meta">同义：{entry.synonyms.slice(0, 6).join("，")}</div>
            ) : null}
            {fields.antonyms && entry.antonyms?.length && can("antonyms") ? (
              <div className="dict-meta">反义：{entry.antonyms.slice(0, 6).join("，")}</div>
            ) : null}
            {fields.etymology && entry.etymology && can("etymology") ? (
              <div className="dict-meta">词源：{entry.etymology}</div>
            ) : null}
            {reading?.sentence && (
              <div className="dict-meta">原句：{reading.sentence}</div>
            )}
            <div className="dict-meta mono">来源：{entry.source}{panel.providerId ? `（${panel.providerId}）` : ""}{panel.mode ? ` · ${panel.mode}` : ""}</div>
            <div className="ai-actions" style={{ marginTop: 8, flexDirection: "column", alignItems: "stretch" }}>
              <div className="dict-meta">单词卡形式（{entry.language || "?"} · 按语言记忆）：</div>
              <div className="settings-row" style={{ flexWrap: "wrap", gap: 8 }}>
                {VOCAB_KINDS.map((k) => (
                  <label key={k} style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                    <input type="checkbox" checked={kinds.includes(k)} onChange={() => toggleKind(k)} />
                    {VOCAB_KIND_LABEL[k]}
                  </label>
                ))}
              </div>
              <button
                className="btn btn-primary btn-sm"
                disabled={kinds.length === 0}
                title={kinds.length === 0 ? "至少勾选一种卡片" : undefined}
                onClick={() => {
                  if (!entry || !reading || kinds.length === 0) return;
                  // 一键制卡：按勾选的快照卡入库（dictJson 随插入一次写入，调用方处理）
                  onMakeCards(entry, reading, kinds);
                }}
              >
                {kinds.length === 0 ? "一键制卡（未勾选）" : `一键制卡（${kinds.length} 张）`}
              </button>
              {entry.definitions.length > 2 && (
                <button className="btn btn-outline btn-sm" onClick={() => setShowAll((v) => !v)}>
                  {showAll ? "收起" : `展开全部 ${entry.definitions.length} 条`}
                </button>
              )}
            </div>
          </>
        )}
        {!entry && !panel.running && !panel.error && (
          <div className="dict-meta">未找到释义，可换本地词典重试，或手动制卡。</div>
        )}
      </div>
    </div>
  );
}

export { FIELD_LABELS };
