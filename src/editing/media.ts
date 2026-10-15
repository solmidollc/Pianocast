import type { MediaAsset, ScoreSystem, Crop } from './model';

export function mediaEvent(target: HTMLMediaElement, event: string, timeout = 15000, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); target.removeEventListener(event, done); target.removeEventListener('error', error); signal?.removeEventListener('abort', aborted); };
    const done = () => { cleanup(); resolve(); };
    const error = () => { cleanup(); reject(new Error('This video could not be decoded. Try an MP4 or WebM supported by this browser.')); };
    const aborted = () => { cleanup(); reject(new DOMException('Cancelled', 'AbortError')); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('The video took too long to load. Try another file.')); }, timeout);
    target.addEventListener(event, done, { once: true }); target.addEventListener('error', error, { once: true });
    signal?.addEventListener('abort', aborted, { once: true }); if (signal?.aborted) aborted();
  });
}
export async function seekMedia(video: HTMLVideoElement, time: number, signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  if (Math.abs(video.currentTime - time) < 0.015 && video.readyState >= 2) return;
  const ready = mediaEvent(video, 'seeked', 15000, signal); video.currentTime = Math.max(0, time); await ready;
}
export async function inspectVideo(blob: Blob, name: string, durationHint?: number): Promise<MediaAsset> {
  if (!blob.size) throw new Error('This video is empty.');
  const video = document.createElement('video'), url = URL.createObjectURL(blob);
  video.preload = 'auto'; video.muted = true;
  try {
    const metadata = mediaEvent(video, 'loadedmetadata'); video.src = url; await metadata;
    let duration = video.duration;
    if (!Number.isFinite(duration) && durationHint && durationHint > 0) duration = durationHint;
    if (!Number.isFinite(duration)) {
      // MediaRecorder WebM files often omit their duration. Seeking past the
      // end lets Chromium scan the final cluster without changing the file.
      await seekMedia(video, 1e10); duration = Number.isFinite(video.duration) ? video.duration : video.currentTime;
    }
    if (!Number.isFinite(duration) || duration < 0.1 || duration >= 1e9 || !video.videoWidth) throw new Error('Could not read this video’s duration. Try an MP4 or WebM with a valid duration.');
    return { id: crypto.randomUUID(), name, blob, duration, width: video.videoWidth, height: video.videoHeight };
  } finally { video.pause(); video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); }
}
export function canvasBlob(canvas: HTMLCanvasElement, type = 'image/jpeg', quality = 0.92) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not create the image.')), type, quality));
}
export async function cropScore(page: HTMLCanvasElement, crop: Crop, pageNumber: number, label: string): Promise<ScoreSystem> {
  const { cropPixels } = await import('./model');
  const rect = cropPixels(crop, page.width, page.height);
  if (rect.width < 30 || rect.height < 15) throw new Error('Drag a rectangle around the complete grand-staff system.');
  const canvas = document.createElement('canvas'); canvas.width = rect.width; canvas.height = rect.height;
  canvas.getContext('2d')!.drawImage(page, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
  return { id: crypto.randomUUID(), label, page: pageNumber, crop, image: await canvasBlob(canvas, 'image/png') };
}
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
