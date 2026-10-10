export function fitPhoto(width: number, height: number, viewportWidth: number, viewportHeight: number) {
  const factor = Math.min(viewportWidth / width, viewportHeight * 0.84 / height);
  return { width: width * factor, height: height * factor };
}

export function clampPan(value: number, imageSize: number, viewportSize: number, scale: number) {
  'worklet';
  const limit = Math.max(0, (imageSize * scale - viewportSize) / 2);
  return Math.max(-limit, Math.min(limit, value));
}

export function isOutsidePhoto(x: number, y: number, width: number, height: number, viewportWidth: number, viewportHeight: number, scale: number, offsetX: number, offsetY: number) {
  'worklet';
  return Math.abs(x - viewportWidth / 2 - offsetX) > width * scale / 2
    || Math.abs(y - viewportHeight / 2 - offsetY) > height * scale / 2;
}
