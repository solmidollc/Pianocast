import { useApp } from '../state/store';

// Copy only module content, never the editor frame or its selection handles.
// Rasterize media at the current frame and inline styles so the SVG is self-contained.
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
    const frame = document.createElement('canvas');
    frame.width = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
    frame.height = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
    if (frame.width && frame.height) {
      frame.getContext('2d')!.drawImage(source, 0, 0);
      image.src = frame.toDataURL('image/png');
    }
    return image;
  }
  for (const child of Array.from(source.childNodes)) {
    copy.appendChild(child instanceof Element ? copyContent(child) : child.cloneNode());
  }
  return copy;
}

export async function createSceneCapture(onError: (message: string) => void) {
  const canvas = document.createElement('canvas');
  const state = useApp.getState();
  canvas.width = state.canvasWidth;
  canvas.height = state.canvasHeight;
  if (!canvas.captureStream) throw new Error('Scene recording is unavailable in this browser.');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create the recording canvas.');
  let stopped = false;
  let timer: number | undefined;

  async function draw() {
    const scene = useApp.getState();
    const root = document.createElement('div');
    root.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    Object.assign(root.style, {
      position: 'relative', width: canvas.width + 'px', height: canvas.height + 'px',
      overflow: 'hidden', background: scene.background.type === 'solid' ? scene.background.color : '#000',
    });
    for (const module of [...scene.modules].filter(m => m.visible).sort((a, b) => a.z - b.z)) {
      const source = document.querySelector('[data-recording-module="' + module.id + '"]');
      if (!source) continue;
      const content = copyContent(source) as HTMLElement;
      Object.assign(content.style, {
        position: 'absolute', left: module.x + 'px', top: module.y + 'px',
        right: 'auto', bottom: 'auto', width: module.width + 'px', height: module.height + 'px',
        cursor: 'default', overflow: 'hidden',
      });
      root.appendChild(content);
    }
    const markup = new XMLSerializer().serializeToString(root);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + canvas.width + '" height="' + canvas.height + '"><foreignObject width="100%" height="100%">' + markup + '</foreignObject></svg>';
    const image = new Image();
    // Data URLs keep self-contained SVGs origin-clean for canvas capture.
    image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    await image.decode();
    if (stopped) return;
    ctx!.drawImage(image, 0, 0);
  }

  // Fail before starting the encoder if the browser cannot rasterize this scene.
  await draw();
  const stream = canvas.captureStream(30);
  const tick = async () => {
    if (stopped) return;
    try { await draw(); }
    catch (error) {
      stopped = true;
      onError(error instanceof Error ? error.message : 'Scene rendering failed');
      return;
    }
    if (!stopped) timer = window.setTimeout(tick, 33);
  };
  timer = window.setTimeout(tick, 33);
  return {
    stream,
    dispose() {
      stopped = true;
      window.clearTimeout(timer);
      stream.getTracks().forEach(track => track.stop());
    },
  };
}
