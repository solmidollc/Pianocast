import type { EditDraft } from './model';

export interface Rect { x: number; y: number; width: number; height: number }
export type DrawContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export const MIN_VIDEO_ZOOM = 0.25, MAX_VIDEO_ZOOM = 3;
const finite = (value: number | undefined, fallback: number) => Number.isFinite(value) ? value! : fallback;
export const scoreSize = (value?: number) => Math.max(0.25, Math.min(1, finite(value, 1)));
export function videoTransform(draft: Pick<EditDraft, 'videoZoom' | 'videoOffsetX' | 'videoOffsetY'>) {
  return {
    zoom: Math.max(MIN_VIDEO_ZOOM, Math.min(MAX_VIDEO_ZOOM, finite(draft.videoZoom, 1))),
    offsetX: Math.max(-1, Math.min(1, finite(draft.videoOffsetX, 0))),
    offsetY: Math.max(-1, Math.min(1, finite(draft.videoOffsetY, 0))),
  };
}

/** Ignore only empty white/transparent margins, retaining all visible notation. */
export function scoreContentBounds(pixels: Uint8ClampedArray, width: number, height: number): Rect {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    if (pixels[i + 3] > 16 && Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) < 245) {
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  }
  if (right < left) return { x: 0, y: 0, width, height };
  // One source pixel protects antialiasing at the content boundary.
  left = Math.max(0, left - 1); top = Math.max(0, top - 1);
  right = Math.min(width - 1, right + 1); bottom = Math.min(height - 1, bottom + 1);
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

export async function prepareScoreImage(blob: Blob): Promise<ImageBitmap> {
  const image = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!; ctx.drawImage(image, 0, 0);
    const bounds = scoreContentBounds(ctx.getImageData(0, 0, image.width, image.height).data, image.width, image.height);
    return await createImageBitmap(image, bounds.x, bounds.y, bounds.width, bounds.height);
  } finally { image.close(); }
}

/** Shrink the entire score uniformly, returning the freed height to the video. */
export function scoreBandHeight(image: { width: number; height: number } | undefined, width: number, height: number, size?: number) {
  return image ? Math.ceil(Math.min(height * 0.75, width * image.height / image.width) * scoreSize(size)) : 0;
}
export function drawScore(ctx: DrawContext, image: ImageBitmap | undefined, width: number, band: number, size?: number) {
  if (!band) return;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, band);
  if (!image) return;
  const scale = Math.min(width * scoreSize(size) / image.width, band / image.height);
  const w = image.width * scale, h = image.height * scale;
  ctx.drawImage(image, (width - w) / 2, (band - h) / 2, w, h);
}

/** Uniform scaling with independent horizontal and vertical movement. */
export function videoRect(draft: Pick<EditDraft, 'scoreLayout' | 'scoreSpace' | 'videoZoom' | 'videoOffsetX' | 'videoOffsetY'>, width: number, height: number, sourceWidth: number, sourceHeight: number, band: number): Rect {
  const top = draft.scoreLayout === 'above' ? band : 0, availableHeight = draft.scoreLayout === 'overlay' ? height : height - band;
  const { zoom, offsetX, offsetY } = videoTransform(draft);
  const fit = draft.scoreSpace === undefined ? Math.min : Math.max;
  const scale = fit(width / sourceWidth, availableHeight / sourceHeight) * zoom;
  const w = sourceWidth * scale, h = sourceHeight * scale;
  return { x: (width - w) / 2 + offsetX * width / 2, y: top + (availableHeight - h) / 2 + offsetY * height / 2, width: w, height: h };
}

/** Reserved output space is independent of the active crop and its display size. */
export function scoreSpace(draft: Pick<EditDraft, 'scoreSpace' | 'scoreHeight'>) {
  return Math.max(0.1, Math.min(0.6, finite(draft.scoreSpace, finite(draft.scoreHeight, .24))));
}
export function compositionBand(draft: Pick<EditDraft, 'scoreSpace' | 'scoreHeight'>, height: number) {
  return Math.round(height * scoreSpace(draft));
}
export function scoreTop(draft: Pick<EditDraft, 'scoreLayout'>, height: number, band: number) {
  return draft.scoreLayout === 'below' ? height - band : 0;
}
export function scoreAspect(images: Iterable<{ width: number; height: number }>) {
  return Math.max(1, ...[...images].map(image => image.width / image.height));
}
/** Paint within a fixed score area, above or below a video whose geometry never changes. */
export function drawCompositionScore(ctx: DrawContext, image: ImageBitmap | undefined, draft: EditDraft, width: number, height: number, aspect?: number) {
  const band = compositionBand(draft, height), top = scoreTop(draft, height, band);
  ctx.save(); ctx.translate(0, top);
  if (!image) drawScore(ctx, image, width, band, draft.scoreScale);
  else if (draft.scoreSizing !== 'per-crop') {
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, band);
    const scale = Math.min(width / (image.height * (aspect || image.width / image.height)), band / image.height) * scoreSize(draft.scoreScale);
    const w = image.width * scale, h = image.height * scale;
    ctx.drawImage(image, (width - w) / 2, (band - h) / 2, w, h);
  }
  else {
    ctx.fillStyle = '#0c0d10'; ctx.fillRect(0, 0, width, band);
    const scale = Math.min(width / image.width, band / image.height) * scoreSize(draft.scoreScale);
    const w = image.width * scale, h = image.height * scale;
    ctx.drawImage(image, (width - w) / 2, (band - h) / 2, w, h);
  }
  ctx.restore();
}
