import { useEffect, useRef } from 'react';
import { boardSize, drawInk, inkGeometry } from './model';
import { inkState, subscribeInk } from './store';
import { renderPDFPage, subscribePDF } from './pdfSource';
export function useInkCanvas(board:string,width:number,height:number) {
  const ref=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{
    const ink=document.createElement('canvas');ink.width=Math.round(width);ink.height=Math.round(height);
    let frame=0,disposed=false,request=0,pageImage:HTMLCanvasElement|null=null,pageKey='';
    const paint=()=>{
      frame=0;const target=ref.current,ctx=target?.getContext('2d');if(!target||!ctx)return;
      const d=inkState(board).document;
      const key=d.pdf ? d.pdf.id+':'+d.pdf.index : '';
      if(d.pdf && key!==pageKey) {
        pageKey=key;const token=++request;
        void renderPDFPage(board,d.pdf.index).then(image=>{if(!disposed&&request===token){pageImage=image;paint();}})
          .catch(()=>{if(!disposed&&request===token){pageKey='';}});
      }
      ctx.clearRect(0,0,width,height);
      if(d.pdf && pageImage) {
        const g=inkGeometry(d),fit=Math.min(width/g.w,height/g.h);
        ctx.save();ctx.translate((width-g.w*fit)/2,(height-g.h*fit)/2);ctx.scale(fit,fit);
        ctx.beginPath();ctx.rect(0,0,g.w,g.h);ctx.clip();
        ctx.drawImage(pageImage,0,g.oy,g.pw,g.ph);ctx.restore();
      } else if(!d.pdf) {pageImage=null;pageKey='';request++;}
      const inkCtx=ink.getContext('2d')!;drawInk(inkCtx,d,width,height);ctx.drawImage(ink,0,0,width,height);
    };
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(paint);};
    const unsub=subscribeInk(board,schedule),unsubPDF=subscribePDF(board,()=>{pageKey='';schedule();});
    paint();
    return()=>{disposed=true;request++;cancelAnimationFrame(frame);unsub();unsubPDF();};
  },[board,width,height]);
  return ref;
}
