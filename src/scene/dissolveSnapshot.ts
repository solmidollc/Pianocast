import type { ModuleInstance, SceneBackground } from '../state/store';

let snapshot: HTMLElement | null = null;

// Freeze the complete outgoing composition before React changes its layout.
// Camera frames are copied directly; no second stream or video playback starts.
export function captureDissolve(modules: ModuleInstance[], background: SceneBackground) {
  const scene = document.createElement('div');
  Object.assign(scene.style, { position: 'absolute', inset: '0', overflow: 'hidden',
    background: background.type === 'solid' ? background.color : '#000' });
  for (const module of modules.filter(m => m.visible).sort((a,b) => a.z-b.z)) {
    const source = document.querySelector<HTMLElement>('[data-recording-module="' + module.id + '"]');
    if (!source) continue;
    const copy = source.cloneNode(true) as HTMLElement;
    copy.removeAttribute('data-recording-module');
    const originals = source.querySelectorAll('video, canvas');
    copy.querySelectorAll('video, canvas').forEach((media, i) => {
      const original = originals[i] as HTMLVideoElement | HTMLCanvasElement;
      const canvas = document.createElement('canvas');
      const video = original instanceof HTMLVideoElement;
      canvas.width = video ? original.videoWidth : original.width;
      canvas.height = video ? original.videoHeight : original.height;
      canvas.style.cssText = (media as HTMLElement).style.cssText;
      canvas.className = media.getAttribute('class') ?? '';
      // Canvas uses the same native aspect ratio and crop transform as video.
      if (canvas.width && canvas.height) {
        try { canvas.getContext('2d')?.drawImage(original, 0, 0); } catch { /* source not ready */ }
      }
      media.replaceWith(canvas);
    });
    const frame = document.createElement('div');
    Object.assign(frame.style, { position: 'absolute', left: module.x + 'px', top: module.y + 'px',
      width: module.width + 'px', height: module.height + 'px', overflow: 'hidden',
      opacity: String(module.options.transitionOpacity ?? 1) });
    frame.append(copy);
    scene.append(frame);
  }
  snapshot = scene;
}
export function getDissolveSnapshot() { return snapshot ?? undefined; }
