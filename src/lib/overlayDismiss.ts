import { useMemo, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { isDialogStackTop } from "./dialogA11y";
import { createBackdropDismissGuard } from "./overlayDismissCore.mjs";

export function useOverlayBackdrop<T extends HTMLElement>(
  panelRef: RefObject<T | null>,
  onRequestClose: () => void,
  options?: {
    isBlank?: (target: EventTarget | null, currentTarget: EventTarget | null) => boolean;
  }
) {
  const closeRef = useRef(onRequestClose);
  closeRef.current = onRequestClose;
  const blankRef = useRef(options?.isBlank);
  blankRef.current = options?.isBlank;
  const guardRef = useRef(createBackdropDismissGuard((target, currentTarget) =>
    blankRef.current
      ? blankRef.current(target, currentTarget)
      : target === currentTarget
  ));

  return useMemo(() => {
    const top = () => isDialogStackTop(panelRef.current);
    return {
      onPointerDown: (event: ReactPointerEvent<T>) => guardRef.current.down(event, top()),
      onPointerUp: (event: ReactPointerEvent<T>) => {
        if (guardRef.current.up(event, top())) closeRef.current();
      },
      onPointerCancel: () => guardRef.current.cancel()
    };
  }, [panelRef]);
}
