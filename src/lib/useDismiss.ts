import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 模态出场两步走（MOTION-DESIGN-SPEC §8.1，D120）：requestClose() 先翻 show=false
 * （宿主在 backdrop/panel 上渲染 data-show="out"，theme.css 播 modal-out/panel-out），
 * 100ms（= --dur-exit）后再调真 onClose 卸载——关闭不再瞬灭。
 *
 * 纪律（§8.1 逐字）：
 *  - Esc（useDialogA11y）、遮罩点击、关闭/取消按钮一律走同一个 requestClose；
 *  - 出场途中重复触发幂等：不叠加计时器、不重复回调 onClose；
 *  - reduce 下无出场动画（CSS 规则不在场），且延迟短路为 0ms = 瞬时关闭；
 *  - 父级若绕过 requestClose 直接卸载时，卸载清理兜底清计时器。
 */
const EXIT_MS = 100; // = theme.css --dur-exit（JS 侧无法直接读 CSS 变量，常量对齐 token）

/** reduce 用户：出场动画不在场，延迟短路为 0（关闭 <16ms）；无 matchMedia 的旧环境走正常延迟 */
function resolveExitMs(): number {
  try {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return 0;
  } catch {
    /* 特性检测失败 → 走正常延迟 */
  }
  return EXIT_MS;
}

export function useDismiss(onClose: () => void) {
  const [show, setShow] = useState(true);
  const closingRef = useRef(false);
  const timerRef = useRef(0);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setShow(false);
    timerRef.current = window.setTimeout(() => onCloseRef.current(), resolveExitMs());
  }, []);

  return { show, requestClose } as const;
}
