import { useEffect } from 'react';
import { dispatchInk,requestInk } from '../annotation/store';
import { useInkCanvas } from '../annotation/useInkCanvas';
import { lockedBoardSize } from '../annotation/connectionLock';
export function AnnotationModule({board,width,height}:{board:string;width:number;height:number}) {
  const ref=useInkCanvas(board,width,height);
  useEffect(()=>{
    if(new URLSearchParams(window.location.search).get('view')!=='output' && !lockedBoardSize(board))dispatchInk(board,{type:'dimensions',width,height});
    requestInk(board);
  },[board,width,height]);
  return <canvas ref={ref} width={Math.max(1,Math.round(width))} height={Math.max(1,Math.round(height))}
    aria-label="Live annotations" style={{width,height,display:'block',pointerEvents:'none'}}/>;
}
