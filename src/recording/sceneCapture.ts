import { useApp, type ModuleInstance } from '../state/store';

function copyContent(source: Element): Element {
  const copy = source.cloneNode(false) as Element;
  const style = getComputedStyle(source);
  let css = '';
  for (const name of Array.from(style)) {
    css += name + ':' + style.getPropertyValue(name).replace(/url\(["']?[^)"']*#([^)"']+)["']?\)/g, 'url(#$1)') + ';';
  }
  copy.setAttribute('style', css);
  if (source instanceof HTMLVideoElement || source instanceof HTMLCanvasElement) {
    const image = document.createElement('img');
    image.setAttribute('style', css);
    if (style.display === 'none') return image;
    // Live media is drawn directly by the compositor, without PNG encoding.
    image.style.visibility = 'hidden';
    return image;
  }
  for (const child of Array.from(source.childNodes)) {
    copy.appendChild(child instanceof Element ? copyContent(child) : child.cloneNode());
  }
  return copy;
}


interface Layer {
  source: HTMLElement;
  image: HTMLImageElement | null;
  dirty: boolean;
  pending: Promise<void> | null;
  observer: MutationObserver;
  size: string;
}

export async function createSceneCapture(onError: (message: string) => void) {
  const canvas = document.createElement('canvas');
  const initial = useApp.getState();
  canvas.width = initial.canvasWidth;
  canvas.height = initial.canvasHeight;
  if (!canvas.captureStream) throw new Error('Scene recording is unavailable in this browser.');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create the recording canvas.');
  const layers = new Map<string, Layer>();
  let stopped = false;
  let frame = 0;
  let lastFrame = -Infinity;

  function getLayer(module: ModuleInstance): Layer | null {
    const source = document.querySelector<HTMLElement>('[data-recording-module="' + module.id + '"]');
    if (!source) return null;
    let layer = layers.get(module.id);
    if (layer && layer.source !== source) {
      layer.observer.disconnect();
      layers.delete(module.id);
      layer = undefined;
    }
    if (!layer) {
      const observer = new MutationObserver(() => { const current = layers.get(module.id); if (current) current.dirty = true; });
      layer = { source, image: null, dirty: true, pending: null, observer, size: '' };
      observer.observe(source, { attributes: true, childList: true, characterData: true, subtree: true });
      layers.set(module.id, layer);
    }
    const size = module.width + ':' + module.height;
    if (layer.size !== size) { layer.size = size; layer.dirty = true; }
    return layer;
  }

  function refresh(layer: Layer, module: ModuleInstance): Promise<void> {
    if (layer.pending) return layer.pending;
    if (!layer.dirty) return Promise.resolve();
    layer.dirty = false;
    layer.pending = (async () => {
      const content = copyContent(layer.source) as HTMLElement;
      content.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
      Object.assign(content.style, {
        position: 'relative', left: '0', top: '0', right: 'auto', bottom: 'auto',
        width: module.width + 'px', height: module.height + 'px',
        cursor: 'default', overflow: 'hidden',
      });
      const markup = new XMLSerializer().serializeToString(content);
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + module.width + '" height="' + module.height + '"><foreignObject width="100%" height="100%">' + markup + '</foreignObject></svg>';
      const image = new Image();
      image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      await image.decode();
      if (!stopped) layer.image = image;
    })().finally(() => { layer.pending = null; });
    return layer.pending;
  }

  function drawMedia(source: HTMLElement, module: ModuleInstance) {
    const bounds = source.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const scaleX = module.width / bounds.width;
    const scaleY = module.height / bounds.height;
    for (const media of Array.from(source.querySelectorAll('video, canvas'))) {
      const style = getComputedStyle(media);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const video = media instanceof HTMLVideoElement;
      if (video && (media.readyState < 2 || !media.videoWidth)) continue;
      const rect = media.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const width = rect.width * scaleX;
      const height = rect.height * scaleY;
      const x = module.x + (rect.left - bounds.left) * scaleX;
      const y = module.y + (rect.top - bounds.top) * scaleY;
      ctx!.save();
      // The media modules use centered mirror/digital-zoom transforms.
      // Bounding rectangles already include the zoom; restore the mirror sign.
      const transform = style.transform === 'none' ? null : new DOMMatrix(style.transform);
      ctx!.translate(x + width / 2, y + height / 2);
      ctx!.scale(transform && transform.a < 0 ? -1 : 1, transform && transform.d < 0 ? -1 : 1);
      ctx!.filter = style.filter;
      if (video) {
        const element = media as HTMLVideoElement;
        const fit = style.objectFit;
        if (fit === 'cover') {
          const ratio = Math.max(width / element.videoWidth, height / element.videoHeight);
          const sw = width / ratio, sh = height / ratio;
          ctx!.drawImage(element, (element.videoWidth - sw) / 2, (element.videoHeight - sh) / 2,
            sw, sh, -width / 2, -height / 2, width, height);
        } else {
          ctx!.drawImage(element, -width / 2, -height / 2, width, height);
        }
      } else {
        ctx!.drawImage(media as HTMLCanvasElement, -width / 2, -height / 2, width, height);
      }
      ctx!.restore();
    }
  }

  function draw() {
    const scene = useApp.getState();
    ctx!.filter = 'none';
    ctx!.fillStyle = scene.background.type === 'solid' ? scene.background.color : '#000';
    ctx!.fillRect(0, 0, canvas.width, canvas.height);
    const visible = [...scene.modules].filter(m => m.visible).sort((a, b) => a.z - b.z);
    const ids = new Set(visible.map(m => m.id));
    for (const [id, layer] of layers) {
      if (!ids.has(id)) { layer.observer.disconnect(); layers.delete(id); }
    }
    for (const module of visible) {
      const layer = getLayer(module);
      if (!layer) continue;
      if (layer.dirty && !layer.pending) void refresh(layer, module).catch(fail);
      ctx!.save();
      ctx!.beginPath();
      ctx!.rect(module.x, module.y, module.width, module.height);
      ctx!.clip();
      if (layer.image) ctx!.drawImage(layer.image, module.x, module.y, module.width, module.height);
      drawMedia(layer.source, module);
      ctx!.restore();
    }
  }

  function fail(error: unknown) {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(frame);
    for (const layer of layers.values()) layer.observer.disconnect();
    onError(error instanceof Error ? error.message : 'Scene rendering failed');
  }

  try {
    await Promise.all(initial.modules.filter(m => m.visible).map(module => {
      const layer = getLayer(module);
      return layer ? refresh(layer, module) : Promise.resolve();
    }));
    draw();
  } catch (error) {
    stopped = true;
    for (const layer of layers.values()) layer.observer.disconnect();
    throw error;
  }
  const stream = canvas.captureStream(30);
  const tick = (time: number) => {
    if (stopped) return;
    if (time - lastFrame >= 1000 / 30 - 1) {
      lastFrame = time;
      try { draw(); } catch (error) { fail(error); return; }
    }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return {
    stream,
    dispose() {
      stopped = true;
      cancelAnimationFrame(frame);
      for (const layer of layers.values()) layer.observer.disconnect();
      layers.clear();
      stream.getTracks().forEach(track => track.stop());
    },
  };
}
