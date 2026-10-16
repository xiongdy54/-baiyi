// 设置页行内说明 tooltip（v48.70 / D114，设计稿 SETTINGS-REDESIGN-D114.md §8）：
// ⓘ 触发器 + 自定义浮层。全页唯一 tooltip 实现点。
// 不用原生 title：OS 延迟不可控、Electron 下键盘 focus 触发无保证、样式无法守 Token、
// 且会被窗口边缘裁剪（D56 翻边规则）——§8.1 实现决策表。
//
// 交互规格（§8.2，逐条对应）：
//   pointerenter(fine) 500ms 后显示（hover intent，防扫过轰炸）；
//   pointerleave 立即开始消失（--dur-tip-out 淡出，200ms 内移入浮层可取消，浮层文本可选中复制）；
//   触发器 :focus-visible 立即显示（键盘用户已表达意图，§8.4 键盘等价）；
//   blur / Esc / 点击任处 / 滚动 / 窗口 resize 立即消失；Esc 不冒泡干扰设置模态；
//   pointer: coarse（触屏）点按 ⓘ 切换、点其它处关闭（触屏无 hover，必须有无 hover 等价路径）；
//   同屏最多 1 个：新触发器显示即关旧。
//
// 放置（§8.3）：锚定 ⓘ，竖直优先上方、越界翻下方；水平右缘优先对齐、左越界翻左，再夹进视口。
// 浮层 portal 到 body：设置面板（.settings-panel）是 inline-size 查询容器（含 layout
// containment，会成为 fixed 后代的包含块），portal 出去才能按视口坐标定位、
// 且不被 modal 滚动容器裁剪。
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";
import { useT } from "../lib/i18n";

// §8.2 的交互常量（设计稿定值）。淡出的视觉时长在 CSS 里走 --dur-tip-out；
// 这里的 CLOSE_GRACE_MS 是浮层延迟卸载的宽限窗（指针 200ms 内移入可取消消失），取 §8.2 的 200ms。
const HOVER_INTENT_MS = 500;
const CLOSE_GRACE_MS = 200;
// focus 打开后忽略 focus 滚动的窗口（浏览器聚焦滚入在同一任务内完成，250ms 绰绰有余）
const OPEN_SCROLL_GRACE_MS = 250;
// 浮层与视口边缘的留白（--sp-2 档，与 lib/popoverPlace 的 POPOVER_MARGIN 同口径）
const VIEWPORT_MARGIN = 8;

// 同屏最多 1 个 tooltip（§8.2）：每个打开中的实例注册一个 closer，新实例显示前先全部关掉
const openClosers = new Set<() => void>();

type Phase = "closed" | "open" | "closing";

interface Props {
  /** 行/标题名称：aria-label（「{label}的说明」）与浮层归属用 */
  label: string;
  children: ReactNode;
}

export default function SettingsInfo({ label, children }: Props) {
  const T = useT();
  const [phase, setPhase] = useState<Phase>("closed");
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef(0);
  const closeTimer = useRef(0);
  // 打开时刻：focus 打开时浏览器会把新聚焦的 ⓘ 滚入视口（focus 自带的同步滚动），
  // 这次滚动不使锚点失效，不触发「滚动即关」；宽限仅限 focus 打开路径（hover/touch 打开
  // 无此滚动，记 0 使宽限判据恒不成立——宽限期内的真实滚动同样要关）。
  const openedAt = useRef(0);
  const phaseRef = useRef<Phase>("closed");
  phaseRef.current = phase;
  const tipId = useId();

  const clearTimers = () => {
    window.clearTimeout(hoverTimer.current);
    window.clearTimeout(closeTimer.current);
  };

  const closeNow = () => {
    clearTimers();
    setPhase("closed");
    setPos(null);
  };
  const closeNowRef = useRef(closeNow);
  closeNowRef.current = closeNow;

  const openNow = (src: "hover" | "focus" | "touch") => {
    clearTimers();
    if (phaseRef.current === "open") return;
    // 同屏唯一：先关掉其它打开中的 tooltip（此刻本实例尚未注册 closer，不会自关）
    for (const closer of Array.from(openClosers)) closer();
    setPos(null); // 先挂载再测位（useLayoutEffect 内 paint 前一次到位）
    openedAt.current = src === "focus" ? performance.now() : 0;
    setPhase("open");
  };
  const openNowRef = useRef(openNow);
  openNowRef.current = openNow;

  const requestClose = () => {
    if (phaseRef.current !== "open") return;
    setPhase("closing");
    closeTimer.current = window.setTimeout(() => setPhase("closed"), CLOSE_GRACE_MS);
  };
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;

  // 注册/注销「同屏唯一」closer；卸载时兜底清定时器
  useEffect(() => {
    if (phase !== "open") return;
    const closer = () => closeNowRef.current();
    openClosers.add(closer);
    return () => {
      openClosers.delete(closer);
    };
  }, [phase]);
  useEffect(() => () => clearTimers(), []);

  // 打开/消失期间的全局监听：Esc（capture 于 window，先于 dialogA11y 的 document capture，
  // stopPropagation 后设置模态不关）、点外关闭、滚动即关（锚点位置已失效，不做跟随）
  useEffect(() => {
    if (phase === "closed") return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation(); // §8.2：仅当 tooltip 开着才拦 Esc，不冒泡干扰设置模态
      closeNowRef.current();
    }
    function onDocMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || tipRef.current?.contains(t)) return;
      closeNowRef.current();
    }
    function onScroll() {
      // focus 打开自带的「滚入视口」不关 tooltip（锚点仍有效）；真实滚动在宽限期外
      if (performance.now() - openedAt.current < OPEN_SCROLL_GRACE_MS) return;
      closeNowRef.current();
    }
    // resize 同滚动：锚点视口坐标已失效（fixed 定位不跟随），直接关
    function onResize() {
      closeNowRef.current();
    }
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDocMouseDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDocMouseDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [phase]);

  // 测位（§8.3）：paint 前完成，无闪位
  useLayoutEffect(() => {
    if (phase !== "open") return;
    const btn = btnRef.current;
    const tip = tipRef.current;
    if (!btn || !tip) return;
    const a = btn.getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const m = VIEWPORT_MARGIN;
    // 竖直：优先上方，越界翻下方；仍放不下则夹进视口
    let top = a.top - h - m;
    if (top < m) top = a.bottom + m;
    top = Math.max(m, Math.min(window.innerHeight - m - h, top));
    // 水平：右缘优先对齐，左越界翻左（左缘对齐），再夹进视口右缘（D56 实测一次翻边）
    let left = a.right - w;
    if (left < m) left = a.left;
    left = Math.max(m, Math.min(window.innerWidth - m - w, left));
    setPos({ left, top });
  }, [phase, children]);

  // 行控件容器挂 aria-describedby（tooltip 开着才挂，避免全页噪音，§8.3）
  useEffect(() => {
    const host = btnRef.current?.closest(".settings-row, .form-field, h3, h4");
    if (!host) return;
    if (phase === "open") host.setAttribute("aria-describedby", tipId);
    else host.removeAttribute("aria-describedby");
    return () => host.removeAttribute("aria-describedby");
  }, [phase, tipId]);

  const onPointerEnter = (e: ReactPointerEvent) => {
    if (e.pointerType === "touch") return; // 触屏走点按路径
    // 消失途中移回触发器 → 直接取消消失（与浮层侧 onPointerEnter 对称，避免先淡出再重现）
    if (phaseRef.current === "closing") {
      window.clearTimeout(closeTimer.current);
      setPhase("open");
      return;
    }
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => openNowRef.current("hover"), HOVER_INTENT_MS);
  };
  const onPointerLeave = () => {
    window.clearTimeout(hoverTimer.current);
    requestCloseRef.current();
  };
  const onFocus = (e: ReactFocusEvent) => {
    // :focus-visible 才立现（§8.4：键盘等价通道；鼠标点击焦点不触发）
    if ((e.target as Element).matches?.(":focus-visible")) openNowRef.current("focus");
  };
  const onBlur = () => requestCloseRef.current();
  const onClick = (e: ReactMouseEvent) => {
    // ⓘ 常位于 <label> 内：阻断 label 激活转发
    e.preventDefault();
    e.stopPropagation();
    if (window.matchMedia("(hover: none)").matches) {
      // 触屏：点按切换（§8.2）
      if (phaseRef.current === "closed") openNowRef.current("touch");
      else closeNowRef.current();
    }
  };

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        className="settings-info"
        aria-label={T("{label}的说明", { label })}
        // 淡出（closing）期间保持 true：读屏播报与视觉消失同步，200ms 后才翻 false
        aria-expanded={phase !== "closed"}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        onFocus={onFocus}
        onBlur={onBlur}
        onClick={onClick}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <circle cx="8" cy="8" r="6.5" />
          <path d="M8 7.4v3.4" strokeLinecap="round" />
          <path d="M8 5.1h.01" strokeLinecap="round" strokeWidth="2" />
        </svg>
      </button>
      {phase !== "closed" &&
        createPortal(
          <div
            ref={tipRef}
            id={tipId}
            role="tooltip"
            className="settings-info-tip"
            data-show={phase === "closing" ? "out" : "in"}
            style={pos ? { left: pos.left, top: pos.top } : { visibility: "hidden" }}
            onPointerEnter={() => {
              // §8.2：指针在宽限窗内移入浮层 → 取消消失（文本可选中复制）
              if (phaseRef.current === "closing") {
                window.clearTimeout(closeTimer.current);
                setPhase("open");
              }
            }}
            onPointerLeave={() => requestCloseRef.current()}
          >
            {children}
          </div>,
          document.body
        )}
    </>
  );
}
