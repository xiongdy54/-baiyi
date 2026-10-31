// overlayDismissCore.mjs 的类型声明（渲染层与测试共用同一状态机实现）。
export interface BackdropPointerLike {
  target: EventTarget | null;
  currentTarget: EventTarget | null;
  button: number;
  pointerId: number;
  isPrimary?: boolean;
}

export interface BackdropDismissGuard {
  down(event: BackdropPointerLike, isTop: boolean): void;
  up(event: BackdropPointerLike, isTop: boolean): boolean;
  cancel(): void;
}

export function createBackdropDismissGuard(
  isBlank?: (target: EventTarget | null, currentTarget: EventTarget | null) => boolean
): BackdropDismissGuard;
