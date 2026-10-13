import { describe,it,expect } from 'vitest';
import {emptyInk,reduceInk,inkGeometry,pointOnPaper,type InkStroke} from './model';
const stroke:InkStroke={id:'one',tool:'pen',color:'#000000',size:4,points:[[.2,.3,.5]]};
describe('PDF annotation geometry',()=>{
 it('keeps blank ink proportional after changing the viewport shape',()=>{
   let s=reduceInk(emptyInk(),{type:'dimensions',width:1600,height:900});
   s=reduceInk(s,{type:'begin',stroke});
   s=reduceInk(s,{type:'dimensions',width:960,height:960});
   expect(inkGeometry(s.document)).toMatchObject({scale:.6,ox:0,oy:210});
   expect(pointOnPaper(s.document,480,480,.5)).toEqual([.5,.5,.5]);
 });
 it('maps a scrolled PDF viewport back to the original page',()=>{
   let s=reduceInk(emptyInk(),{type:'dimensions',width:960,height:540});
   s=reduceInk(s,{type:'pdf-page',page:{id:'pdf',name:'Score.pdf',count:2,index:1,aspect:.5}});
   s=reduceInk(s,{type:'scroll',value:1});
   expect(inkGeometry(s.document)).toMatchObject({pw:960,ph:1920,oy:-1380});
   expect(pointOnPaper(s.document,480,0,.5)).toEqual([.5,1380/1920,.5]);
 });
 it('preserves separate ink on each PDF page',()=>{
   let s=reduceInk(emptyInk(),{type:'pdf-page',page:{id:'pdf',name:'Score.pdf',count:2,index:1,aspect:.7}});
   s=reduceInk(s,{type:'begin',stroke});
   s=reduceInk(s,{type:'pdf-page',page:{id:'pdf',name:'Score.pdf',count:2,index:2,aspect:1.4}});
   expect(s.document.strokes).toHaveLength(0);
   s=reduceInk(s,{type:'begin',stroke:{...stroke,id:'two'}});
   s=reduceInk(s,{type:'pdf-page',page:{id:'pdf',name:'Score.pdf',count:2,index:1,aspect:.7}});
   expect(s.document.strokes.map(s=>s.id)).toEqual(['one']);
   s=reduceInk(s,{type:'undo'});expect(s.document.strokes).toHaveLength(0);
   s=reduceInk(s,{type:'redo'});expect(s.document.strokes.map(s=>s.id)).toEqual(['one']);
   s=reduceInk(s,{type:'pdf-page',page:{id:'pdf',name:'Score.pdf',count:2,index:2,aspect:1.4}});
   expect(s.document.strokes.map(s=>s.id)).toEqual(['two']);
 });
});
