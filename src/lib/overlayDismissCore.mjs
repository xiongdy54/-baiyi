export function createBackdropDismissGuard(isBlank = (target, currentTarget) => target === currentTarget) {
  let armedPointerId = null;

  const isBlankPrimaryHit = (event, isTop) =>
    isTop === true &&
    event &&
    isBlank(event.target, event.currentTarget) &&
    event.button === 0 &&
    event.isPrimary !== false;

  return {
    down(event, isTop) {
      armedPointerId = isBlankPrimaryHit(event, isTop) ? event.pointerId : null;
    },
    up(event, isTop) {
      const armed = armedPointerId;
      armedPointerId = null;
      return armed !== null && armed === event.pointerId && isBlankPrimaryHit(event, isTop);
    },
    cancel() {
      armedPointerId = null;
    }
  };
}
