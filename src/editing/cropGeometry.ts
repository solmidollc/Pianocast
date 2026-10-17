import type { Crop } from './model';
export function adjustCrop(crop: Crop, handle: string, dx: number, dy: number): Crop {
  if (handle === 'move') return { ...crop, x: Math.max(0, Math.min(1 - crop.width, crop.x + dx)), y: Math.max(0, Math.min(1 - crop.height, crop.y + dy)) };
  let left = crop.x, top = crop.y, right = left + crop.width, bottom = top + crop.height;
  if (handle.includes('w')) left = Math.max(0, Math.min(right - .02, left + dx));
  if (handle.includes('e')) right = Math.min(1, Math.max(left + .02, right + dx));
  if (handle.includes('n')) top = Math.max(0, Math.min(bottom - .01, top + dy));
  if (handle.includes('s')) bottom = Math.min(1, Math.max(top + .01, bottom + dy));
  return { x: left, y: top, width: right - left, height: bottom - top };
}
