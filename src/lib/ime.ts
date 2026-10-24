import type { KeyboardEvent as ReactKeyboardEvent } from "react";

/** 输入法正在组字（此时的 Enter/Escape 属于输入法，不能当成提交/取消） */
export function isImeComposing(e: KeyboardEvent | ReactKeyboardEvent): boolean {
  const ne = ("nativeEvent" in e ? e.nativeEvent : e) as KeyboardEvent;
  return Boolean(ne.isComposing) || ne.keyCode === 229;
}
