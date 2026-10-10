export function listingGalleryHeight(width: number, height: number) {
  return Math.max(340, Math.min(width * 1.18, height * 0.62, 560));
}
