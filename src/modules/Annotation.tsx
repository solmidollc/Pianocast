import { useEffect,useRef } from 'react';
import { dispatchInk,requestInk } from '../annotation/store';
import { useInkCanvas } from '../annotation/useInkCanvas';
import { editsLocked } from '../annotation/connectionLock';
import { useApp } from '../state/store';
export function AnnotationModule({board,width,height}:{board:string;width:number;height:number}) {
  const renderSize=useRef([width,height]);
  if(!useApp.getState().transitioning)renderSize.current=[width,height];
  const [renderW,renderH]=renderSize.current;
  const ref=useInkCanvas(board,renderW,renderH);
  useEffect(()=>{
    if(new URLSearchParams(window.location.search).get('view')!=='output' && !editsLocked()&&!useApp.getState().transitioning)dispatchInk(board,{type:'dimensions',width,height});
    requestInk(board);
  },[board,width,height]);
  return <canvas ref={ref} width={Math.max(1,Math.round(renderW))} height={Math.max(1,Math.round(renderH))}
    aria-label="Live annotations" style={{width,height,display:'block',pointerEvents:'none'}}/>;
}

