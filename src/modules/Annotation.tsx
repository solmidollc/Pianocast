import { useEffect, useRef } from 'react';
import { drawInk } from '../annotation/model';
import { inkState, subscribeInk, requestInk } from '../annotation/store';
export function AnnotationModule({ board, width, height }: {board:string;width:number;height:number}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let frame = 0;
    const paint = () => { frame=0; const ctx=ref.current?.getContext('2d'); if(ctx) drawInk(ctx,inkState(board).document,width,height); };
    const unsubscribe = subscribeInk(board,() => { if(!frame) frame=requestAnimationFrame(paint); });
    paint(); requestInk(board);
    return () => { unsubscribe(); cancelAnimationFrame(frame); };
  },[board,width,height]);
  return <canvas ref={ref} width={Math.max(1,Math.round(width))} height={Math.max(1,Math.round(height))}
    aria-label="Live annotations" style={{width,height,display:'block',pointerEvents:'none'}} />;
}
