import { useEffect, useRef } from 'react';
import { Glyph, Renderer } from 'vexflow';

/** Standard repeat barline and the engraver's segno glyph, independent of OS fonts. */
export function MusicRepeatIcon() {
  const host = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const element = host.current!; element.replaceChildren();
    const container = document.createElement('div');
    const renderer = new Renderer(container, Renderer.Backends.SVG); renderer.resize(26, 28);
    const ctx = renderer.getContext(); ctx.setFillStyle(getComputedStyle(element).color);
    Glyph.renderGlyph(ctx, 3, 22, 24, 'segno');
    element.appendChild(container.firstElementChild!);
    return () => element.replaceChildren();
  }, []);
  return <span aria-hidden="true" style={{display:'inline-flex',alignItems:'center',height:28}}><svg width="22" height="28" viewBox="0 0 22 28" fill="currentColor"><rect x="3" y="4" width="3" height="20"/><rect x="9" y="4" width="1" height="20"/><circle cx="15" cy="10" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg><span ref={host} /></span>;
}
