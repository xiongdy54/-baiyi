/**
 * buttons-ctas 按压反馈工具（D88 §4.2 / §4.3）。
 * 本批（P0）只定义、不接线：涟漪与 settle 均由真实点击事件驱动，无定时器驻留；
 * 接线面＝设计稿 §4.2/§4.3 白名单（「显示答案」「下一条」「评分四钮」「创建卡片」主 CTA），
 * 由 P2/P3 批次在组件事件里调用。单文件、零依赖。
 */

/**
 * settle 回弹（Exaggeration，主 CTA 专用）：移除类 → 强制 reflow → 加 `.settle`；
 * `animationend` 自摘（keyframes＝theme.css `ctas-settle`，350ms --ease-out-soft）。
 * 语义边界（§2.3-2）：这是按压反馈不是庆祝动画——只允许挂在四类主 CTA 上。
 */
export function settle(el: HTMLElement): void {
  el.classList.remove("settle");
  void el.offsetWidth; // 强制 reflow：保证连续点击时动画重放
  el.classList.add("settle");
  el.addEventListener(
    "animationend",
    () => el.classList.remove("settle"),
    { once: true }
  );
}

/**
 * 涟漪（Secondary Action，仅填充钮）：pointerdown 时生成 `span.ripple`
 * （绝对定位、border-radius:50%、scale(0)→scale(2.8)、520ms --ease-out-soft，动画完移除；
 * keyframes＝theme.css `ctas-ripple`）。`prefers-reduced-motion: reduce` 命中时不挂。
 * 适用面（白名单，禁止扩散）：`.bar-btn.primary`、`.btn-primary`、`.grade.recommended`、
 * dock「创建卡片」钮。返回解绑函数。
 */
export function attachRipple(el: HTMLElement): () => void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return () => {};
  const onDown = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    const d = Math.max(r.width, r.height);
    const s = document.createElement("span");
    s.className = "ripple";
    s.style.width = s.style.height = `${d}px`;
    s.style.left = `${e.clientX - r.left - d / 2}px`;
    s.style.top = `${e.clientY - r.top - d / 2}px`;
    el.appendChild(s);
    s.addEventListener("animationend", () => s.remove(), { once: true });
    window.setTimeout(() => s.remove(), 520); // 兜底：animationend 丢失（如元素中途 hidden）也不残留
  };
  el.addEventListener("pointerdown", onDown);
  return () => el.removeEventListener("pointerdown", onDown);
}
