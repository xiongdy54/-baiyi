// 快速记录编辑器（v36，M8-A，§6.5.2）——「草稿-发送」协议的渲染端。
//
// 契约（用户 2026-09-14 拍板，D34）：
//  · 输入即自动保存（防抖 1.2s → 主进程内存库；磁盘由主进程节流落盘）——**永不丢**；
//  · 按「发送」（或 Ctrl+Enter）→ 当前全部内容定格为日记里的**一条**，编辑器清空可继续写；
//  · 不按发送而失焦 → 窗口隐藏，草稿保留，再呼出**继续向下写**；
//  · 跨日：非今日的旧草稿默认不混入今天的输入，改由顶部提示条提供「继续写 / 丢弃」。
import { useCallback, useEffect, useRef, useState } from "react";
import { formatClock, journalDateLabel, todayJournalDate, type JournalEntry } from "../lib/journal";
import { applyAccent } from "../lib/accentVar";
import MarkdownEditor, { type MarkdownEditorApi } from "./editor/MarkdownEditor";
import { useT } from "../lib/i18n";

const AUTOSAVE_DEBOUNCE_MS = 1200;
const TOAST_MS = 2600;

type SaveState = "idle" | "typing" | "saved" | "error";

// 捕获窗口是**长生命周期的单例**（首次呼出创建后只隐藏不销毁），故主题/强调色不能只在启动时读一次——
// 每次呼出都重读（用户中途切了主题，下次呼出必须一致；main 侧同时更新窗口底色防白闪）。
export async function applyCaptureAppearance(): Promise<void> {
  try {
    const mode = (await window.settingsAPI?.get("theme", "mode")) as string | undefined;
    document.body.classList.toggle("theme-dark", mode === "dark");
    document.body.classList.toggle("theme-light", mode !== "dark");
    const accent = (await window.settingsAPI?.get("app", "accentColor")) as string | undefined;
    // 与主窗口同一入口：自定义 accent 时同步反白档 --accent-on
    applyAccent(accent);
  } catch {
    document.body.classList.add("theme-light");
  }
}

export default function CaptureEditor() {
  const T = useT();
  const [text, setText] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [today, setToday] = useState(todayJournalDate());
  const [todayCount, setTodayCount] = useState(0);
  const [foreignDraft, setForeignDraft] = useState<JournalEntry | null>(null);
  const [continuingForeign, setContinuingForeign] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const mdRef = useRef<MarkdownEditorApi | null>(null);
  const debounceRef = useRef<number | null>(null);
  const toastRef = useRef<number | null>(null);
  const textRef = useRef("");
  const dirtyRef = useRef(false); // 有尚未送出的输入（决定失焦/隐藏前是否要补一次保存）
  const sendingRef = useRef(false); // 发送并发闸（ref 同步，双击不会发出两条）
  const shellRef = useRef<HTMLDivElement | null>(null); // .cap-shell 根节点（入场重触发用）

  const focusEditor = useCallback(() => {
    // §J P0：编辑器内容区聚焦，光标落到文档末尾（「继续向下写」语义，与旧 textarea 一致）
    mdRef.current?.focusEnd();
  }, []);

  // MOTION-DESIGN-SPEC §8.5 弹出族语义（D120 R3）：capture 是长生命周期单例窗口，
  // hide→show 不卸载组件，CSS animation 只在首帧播一次——每次呼出需重触发 cap-enter。
  // 手法：内联 animation 置 none → 强制 reflow 作废旧动画状态 → 清空内联，交还 CSS
  // （no-preference 作用域）接管重播；reduce 下规则不在场，此操作为 no-op。
  // 只动 style.animation，无新增监听/无残留 class（满足「保持 CSS 驱动原则」）。
  function restartEnter() {
    const el = shellRef.current;
    if (!el) return;
    el.style.animation = "none";
    void el.offsetHeight; // 强制 reflow：浏览器同步丢弃旧动画状态
    el.style.animation = "";
  }

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastRef.current) window.clearTimeout(toastRef.current);
    toastRef.current = window.setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  // 载入当日视图：条数 + 草稿。adoptDraft=呼出/首帧时把草稿内容接进编辑器（本地有未保存输入时不覆盖）
  const reload = useCallback(async (adoptDraft: boolean) => {
    const api = window.captureAPI;
    if (!api) return;
    const day = await api.day();
    setToday(day.date);
    setTodayCount(day.count);
    const draft = day.draft;
    if (draft && draft.entryDate === day.date) {
      setForeignDraft(null);
      setContinuingForeign(false);
      if (adoptDraft && !dirtyRef.current) {
        setText(draft.contentMarkdown);
        textRef.current = draft.contentMarkdown;
        setSaveState(draft.contentMarkdown.trim() ? "saved" : "idle");
        setSavedAt(draft.updatedAt);
      }
    } else if (draft) {
      // 跨日草稿：不混稿、但绝不隐身（顶部提示条提供继续写 / 丢弃）
      setForeignDraft(draft);
      setContinuingForeign(false);
      if (adoptDraft && !dirtyRef.current) {
        setText("");
        textRef.current = "";
        setSaveState("idle");
        setSavedAt(null);
      }
    } else {
      setForeignDraft(null);
      setContinuingForeign(false);
      if (adoptDraft && !dirtyRef.current) {
        setText("");
        textRef.current = "";
        setSaveState("idle");
        setSavedAt(null);
      }
    }
  }, []);

  const save = useCallback(async () => {
    const api = window.captureAPI;
    if (!api) return;
    const value = textRef.current;
    try {
      const res = await api.draftSave(value);
      dirtyRef.current = false;
      setSaveState(value.trim() ? "saved" : "idle");
      setSavedAt(Date.now());
      if (res?.entry && res.entry.entryDate !== todayJournalDate()) setForeignDraft(res.entry);
    } catch {
      setSaveState("error");
    }
  }, []);

  const flush = useCallback(async () => {
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (dirtyRef.current) await save();
  }, [save]);

  const send = useCallback(async () => {
    const api = window.captureAPI;
    const value = textRef.current;
    if (!api || sendingRef.current || !value.trim()) return;
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    sendingRef.current = true;
    setSending(true);
    try {
      const res = await api.draftSend(value);
      dirtyRef.current = false;
      setText("");
      textRef.current = "";
      setSaveState("idle");
      setSavedAt(null);
      setForeignDraft(null);
      setContinuingForeign(false);
      setConfirmDiscard(false);
      const day = await api.day();
      setToday(day.date);
      setTodayCount(day.count);
      showToast(T("已记入 {date} 日记 · {time}", { date: journalDateLabel(res.entry.entryDate), time: formatClock(res.entry.sentAt || Date.now()) }));
      focusEditor();
    } catch {
      setSaveState("error");
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, [focusEditor, showToast]);

  function handleChange(value: string) {
    setText(value);
    textRef.current = value;
    dirtyRef.current = true;
    setSaveState("typing");
    setConfirmDiscard(false);
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      void save();
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  // §J P0：Esc 语义由 MarkdownEditor 内部承接（先提交再通知），这里补「隐藏窗口」（绝不因隐藏丢字）
  function handleEscape() {
    void (async () => {
      await flush();
      await window.captureAPI?.hide();
    })();
  }

  // §J P0：Ctrl+Enter 发送（编辑器其余键全部交给 markdown 输入，Enter＝换行段落）
  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void send();
    }
  }

  // 首帧：载入草稿（有今日草稿则继续写）→ 渲染完成 → 通知主进程「就绪」→ 主进程才显示窗口
  useEffect(() => {
    let cancelled = false;
    void reload(true).then(() => {
      if (cancelled) return;
      requestAnimationFrame(() => window.captureAPI?.ready());
    });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  // 每次呼出：重触发入场（§8.5 弹出族语义）→ 重读外观（主题/强调色可能已变）
  // → 刷新当日条数与草稿（隐藏期间可能已在主窗口编辑过）→ 聚焦、光标置末尾
  useEffect(() => {
    const api = window.captureAPI;
    if (!api) return;
    return api.onShown(() => {
      restartEnter();
      void applyCaptureAppearance()
        .then(() => reload(true))
        .then(() => focusEditor());
    });
  }, [focusEditor, reload]);

  // 失焦（主进程会隐藏窗口）：立即补一次保存，不让防抖窗口吃掉最后几个字
  useEffect(() => {
    const onBlur = () => {
      void flush();
    };
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [flush]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      if (toastRef.current) window.clearTimeout(toastRef.current);
    };
  }, []);

  function continueForeignDraft() {
    if (!foreignDraft) return;
    setText(foreignDraft.contentMarkdown);
    textRef.current = foreignDraft.contentMarkdown;
    dirtyRef.current = false;
    setContinuingForeign(true);
    setSaveState("saved");
    setSavedAt(foreignDraft.updatedAt);
    focusEditor();
  }

  async function discardForeignDraft() {
    if (!foreignDraft) return;
    if (!confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    await window.captureAPI?.discardDraft(foreignDraft.id);
    setForeignDraft(null);
    setContinuingForeign(false);
    setConfirmDiscard(false);
    showToast(T("已丢弃该草稿"));
  }

  const statusText =
    saveState === "error"
      ? T("保存失败，稍后重试")
      : saveState === "typing"
        ? T("输入中…")
        : saveState === "saved" && savedAt
          ? T("已保存 {time}", { time: formatClock(savedAt) })
          : T("输入即自动保存");

  return (
    <div className="cap-shell" ref={shellRef}>
      <header className="cap-header">
        <span className="cap-title">{T("快速记录")}</span>
        <span className="cap-meta mono">
          {journalDateLabel(today)} · {T("今日已记 {n} 条", { n: todayCount })}
        </span>
      </header>

      {foreignDraft && !continuingForeign && (
        <div className="cap-notice">
          <span className="cap-notice-text">
            {T("{date} 有未发送草稿", { date: journalDateLabel(foreignDraft.entryDate) })}
          </span>
          <span className="cap-notice-actions">
            <button className="cap-link" onClick={continueForeignDraft}>
              {T("继续写")}
            </button>
            <button
              className={`cap-link${confirmDiscard ? " cap-link-danger" : ""}`}
              onClick={() => void discardForeignDraft()}
            >
              {confirmDiscard ? T("确认丢弃") : T("丢弃")}
            </button>
          </span>
        </div>
      )}
      {continuingForeign && foreignDraft && (
        <div className="cap-notice">
          <span className="cap-notice-text">
            {T("正在续写 {date} 的草稿 · 发送后归入那天", { date: journalDateLabel(foreignDraft.entryDate) })}
          </span>
        </div>
      )}

      {/* §J P0：主正文统一 Markdown 编辑器（含工具条，形态设置随组件走）。
          滚动区包裹层替换旧 textarea 的 flex:1 撑满；编辑中 onChange 镜像走原防抖自动保存链。 */}
      <div className="cap-editor-scroll">
        <MarkdownEditor
          ref={mdRef}
          value={text}
          onChange={(md) => handleChange(md)}
          onCommit={(md) => {
            if (md !== null) {
              // 失焦/Esc 提交：越过防抖立即定格（md 即最新序列化）
              textRef.current = md;
              dirtyRef.current = true;
              void save();
            }
          }}
          onEscape={handleEscape}
          onKeyDown={handleKeyDown}
          onReady={focusEditor}
          placeholder={T("随手写点什么…（支持 Markdown，输入即自动保存）")}
          className="cap-editor-md"
          toolbarLabel={T("快速记录工具栏")}
        />
      </div>

      <footer className="cap-footer">
        <span className={`cap-status${saveState === "error" ? " cap-status-error" : ""}`}>
          <span
            className={`cap-dot${saveState === "saved" ? " on" : ""}${saveState === "typing" ? " typing" : ""}${
              saveState === "error" ? " err" : ""
            }`}
          />
          {statusText}
        </span>
        <span className="cap-actions">
          {toast && <span className="cap-toast">{toast}</span>}
          <span className="cap-hint mono">{T("Ctrl+Enter 发送 · Esc 隐藏")}</span>
          <button className="btn btn-primary btn-sm" disabled={!text.trim() || sending} onClick={() => void send()}>
            {T("发送")}
          </button>
        </span>
      </footer>
    </div>
  );
}
