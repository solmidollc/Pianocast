import { describe, it, expect } from 'vitest';
import { emptyInk, reduceInk, validDocument, drawInk, type InkStroke } from './model';
const stroke: InkStroke = {id:'a',tool:'pen',color:'#ffffff',size:4,points:[[0,.5,.5]]};
describe('annotation document',()=>{
 it('keeps completed strokes through undo/redo and makes clear reversible',()=>{
  let s=reduceInk(emptyInk(),{type:'begin',stroke});
  s=reduceInk(s,{type:'points',strokeId:'a',offset:1,points:[[1,.5,.5]]});
  expect(s.document.strokes[0].points).toHaveLength(2);
  s=reduceInk(s,{type:'undo'});expect(s.document.strokes).toHaveLength(0);
  s=reduceInk(s,{type:'redo'});expect(s.document.strokes[0].points).toHaveLength(2);
  s=reduceInk(s,{type:'clear'});expect(s.document.strokes).toHaveLength(0);
  s=reduceInk(s,{type:'undo'});expect(s.document.strokes[0].points).toHaveLength(2);
 });
 it('rejects replayed, out-of-order, and malformed points',()=>{
  let s=reduceInk(emptyInk(),{type:'begin',stroke});
  expect(reduceInk(s,{type:'begin',stroke})).toBe(s);
  expect(reduceInk(s,{type:'points',strokeId:'a',offset:0,points:[[1,.5,.5]]})).toBe(s);
  expect(reduceInk(s,{type:'points',strokeId:'a',offset:1,points:[[NaN,.5,.5]]})).toBe(s);
  expect(validDocument({background:'white',strokes:[{...stroke,color:'url(x)'}]})).toBe(false);
 });
 it('preserves aspect ratio and paints the whiteboard behind erased ink',()=>{
  const calls:unknown[][]=[];
  const ctx:any=new Proxy({}, {get:(target:any,key)=>key in target?target[key]:(...args:unknown[])=>calls.push([key,...args]),set:(t,k,v)=>{t[k]=v;calls.push(['set',k,v]);return true;}});
  drawInk(ctx,{background:'white',strokes:[{...stroke,tool:'eraser'}]},1000,1000);
  expect(calls).toContainEqual(['translate',0,218.75]);
  expect(calls).toContainEqual(['scale',.625,.625]);
  expect(calls).toContainEqual(['set','globalCompositeOperation','destination-out']);
  expect(calls).toContainEqual(['set','globalCompositeOperation','destination-over']);
  expect(calls).toContainEqual(['fillRect',0,0,1000,1000]);
  expect(calls.findIndex(c=>c[0]==='fillRect')).toBeGreaterThan(calls.findIndex(c=>c[0]==='restore'));
 });
});

