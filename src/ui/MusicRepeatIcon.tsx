import { useEffect, useRef } from 'react';
import { Glyph, Renderer, Stave, Barline } from 'vexflow';

/** Standard repeat barline and the engraver's segno glyph, independent of OS fonts. */
export function MusicRepeatIcon() {
  const host = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const element = host.current!; element.replaceChildren();
    const container = document.createElement('div');
    const renderer = new Renderer(container, Renderer.Backends.SVG); renderer.resize(50, 28);
    const ctx = renderer.getContext(); ctx.setFillStyle(getComputedStyle(element).color);
    const stave=new Stave(0,-16,22,{spacing_between_lines_px:5});stave.setContext(ctx);
    new Barline(Barline.type.REPEAT_END).setX(20).setContext(ctx).draw(stave);
    Glyph.renderGlyph(ctx, 27, 22, 24, 'segno');
    element.appendChild(container.firstElementChild!);
    return () => element.replaceChildren();
  }, []);
  return <span aria-hidden="true" ref={host} style={{display:'inline-flex',alignItems:'center',height:28}}/>;
}
