import { useEffect, useRef } from "react";

/**
 * 模态 / 全屏 Overlay 的可访问性装配 —— 纯表现层交互，不涉任何业务逻辑。
 *
 * 负责四件事：
 *  1. Esc 关闭；
 *  2. 打开时把焦点移入面板（读屏与键盘用户不会留在已不可见的背景上）；
 *  3. Tab 焦点锁在面板内（模态语义要求背景不可 Tab 到达）；
 *  4. 关闭时把焦点归还给触发它的元素。
 *
 * 用法：
 *   const ref = useDialogA11y<HTMLDivElement>(onClose);
 *   <div className="modal-panel" ref={ref} role="dialog" aria-modal="true" aria-label="…">
 *
 * 背景：项目里 8 个模态此前各自手写 `onClick={onClose}`，只有 ImageLightbox 绑了 Esc，
 * 且全部没有 dialog 语义 —— 键盘用户 Tab 会穿透到遮罩底下的界面里。抽成一个装配，
 * 是为了让 8 处行为一致；散抄 8 遍正是本次要消除的重复模式。
 */
const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),' +
  'textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * 已挂载面板的栈。存在嵌套模态（LeechWizard 里可再开 ContrastCardModal），
 * 若每个实例都独立处理 Esc / Tab，最外层会先把内层还开着的外层关掉、
 * 两个焦点锁也会互相抢焦点。故只有栈顶实例响应键盘。
 */
const stack: HTMLElement[] = [];

export function useDialogA11y<T extends HTMLElement>(onClose: () => void) {
  const ref = useRef<T>(null);
  // onClose 每次渲染都是新函数；放进 ref 里读，避免因此反复重挂监听
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    const opener = document.activeElement as HTMLElement | null;
    stack.push(panel);
    const isTop = () => stack[stack.length - 1] === panel;

    const onKey = (e: KeyboardEvent) => {
      if (!isTop()) return; // 嵌套时只让最上面那个模态响应
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      );
      if (!items.length) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      // 焦点不在面板内（初次 Tab 或已穿透出去）→ 拉回第一 / 最后一项
      if (!active || !panel.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey, true);
    // 焦点已在面板内就不抢（例如由面板内按钮二次打开的场景）
    if (!panel.contains(document.activeElement)) {
      const target = panel.querySelector<HTMLElement>(FOCUSABLE) ?? panel;
      if (!target.hasAttribute("tabindex") && target === panel) panel.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
    }

    return () => {
      document.removeEventListener("keydown", onKey, true);
      const i = stack.indexOf(panel);
      if (i >= 0) stack.splice(i, 1);
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, []);

  return ref;
}
