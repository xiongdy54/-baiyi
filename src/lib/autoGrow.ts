// 输入框随内容伸缩（D123 修订）：默认只占一行，内容增多时高度按项目动效（--dur-panel + --ease，CSS 承担）平滑过渡。
// 两种用法：
//   growTextarea(el, max)      —— 原生 textarea（测量 scrollHeight，先把高度钉在旧值再设新值，保证 transition 有起点）
//   useGrowBox(deps)           —— 任意内容块（如 Milkdown 编辑器）：ResizeObserver 量内层高度 → 设外层 clip 高度
import { useLayoutEffect, useRef } from "react";

export function growTextarea(el: HTMLTextAreaElement, max = 120): void {
  const prev = el.offsetHeight;
  const chrome = el.offsetHeight - el.clientHeight; // 上下边框
  el.style.transition = "none";
  el.style.height = "auto";
  const target = Math.min(el.scrollHeight + chrome, max);
  el.style.height = `${prev}px`;
  void el.offsetHeight; // 强制回流：把旧高度固化为过渡起点
  el.style.transition = "";
  el.style.height = `${target}px`;
  el.style.overflowY = el.scrollHeight + chrome > max ? "auto" : "hidden";
}

/** 内容块伸缩：返回 [clipRef, innerRef]；clip 设 overflow:hidden + CSS height 过渡，inner 为自然高度内容。
    首次测量不走过渡（避免挂载时从 0 长出来）。max 封顶后 clip 内部滚动。 */
export function useGrowBox<C extends HTMLElement, I extends HTMLElement>(max = 168) {
  const clipRef = useRef<C | null>(null);
  const innerRef = useRef<I | null>(null);
  useLayoutEffect(() => {
    const clip = clipRef.current;
    const inner = innerRef.current;
    if (!clip || !inner) return;
    let first = true;
    const apply = () => {
      const h = inner.offsetHeight;
      if (first) {
        clip.style.transition = "none";
        clip.style.height = `${Math.min(h, max)}px`;
        void clip.offsetHeight;
        clip.style.transition = "";
        first = false;
      } else {
        clip.style.height = `${Math.min(h, max)}px`;
      }
      clip.style.overflowY = h > max ? "auto" : "hidden";
    };
    apply();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(apply);
    ro.observe(inner);
    return () => ro.disconnect();
  }, [max]);
  return [clipRef, innerRef] as const;
}
