export function fitImage(naturalW, naturalH, availableW, availableH, zoom = 1) {
  const values = [naturalW, naturalH, availableW, availableH, zoom];
  if (!values.every((v) => Number.isFinite(v) && v > 0)) {
    return { fitScale: 0, width: 0, height: 0 };
  }
  const fitScale = Math.min(availableW / naturalW, availableH / naturalH);
  return {
    fitScale,
    width: naturalW * fitScale * zoom,
    height: naturalH * fitScale * zoom
  };
}
