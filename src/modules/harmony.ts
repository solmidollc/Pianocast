import { analyzeFunctional, renderRoman } from './HarmonicReadout';
import type { HarmonicAnalysis,KeyContext } from '../theory/types';
export type HarmonyMode='chord'|'roman'|'figured'|'advanced';
export function harmonyLines(a:HarmonicAnalysis,key:KeyContext,mode:HarmonyMode,intervals=true):string[] {
 if(a.empty)return [];
 const chord=a.chord;
 if(mode==='roman')return chord?[renderRoman(analyzeFunctional(chord,a.notes,key))]:[];
 if(mode==='figured') {
  if(!chord||!a.notes.length)return [];
  const letters='CDEFGAB',bass=a.notes[0],bassStep=bass.octave*7+letters.indexOf(bass.letter);
  const figures=[...new Set(a.notes.slice(1).map(n=>(n.octave*7+letters.indexOf(n.letter)-bassStep+70)%7+1))].filter(n=>n>1).sort((x,y)=>x-y);
  const standard:Record<string,string>={'3,5':'⁵₃','3,6':'⁶','4,6':'⁶₄','3,5,7':'7','3,5,6':'⁶₅','3,4,6':'⁴₃','2,4,6':'⁴₂'};
  return [standard[figures.join(',')]??figures.reverse().join('/')];
 }
 if(mode==='advanced')return [chord?.symbol??'',a.notes.map(n=>n.scientific).join(' · '),...(chord&&chord.inversion>0?[`${chord.inversion}${chord.inversion===1?'st':chord.inversion===2?'nd':chord.inversion===3?'rd':'th'} inversion`]:[]),...(intervals?a.intervals.map(i=>`${i.name} · ${i.long}`):[])].filter(Boolean);
 return chord?[chord.symbol]:[];
}
/** SVG text shares the staff's viewBox, so resizing and export stay aligned. */
export function drawHarmony(svg:SVGSVGElement,a:HarmonicAnalysis,key:KeyContext,mode:HarmonyMode,x:number,top:number,bottom:number,intervals=true,maxWidth=Infinity,centered=false){
 const lines=harmonyLines(a,key,mode,intervals);if(!lines.length)return;
 const namespace='http://www.w3.org/2000/svg',group=document.createElementNS(namespace,'g');group.setAttribute('data-harmony',mode);
 const above=mode==='chord'||mode==='advanced',size=mode==='advanced'?14:22;
 lines.forEach((line,i)=>{const text=document.createElementNS(namespace,'text');text.textContent=line.replaceAll('#','♯').replaceAll('bb','𝄫');text.setAttribute('x',String(x));if(centered)text.setAttribute('text-anchor','middle');text.setAttribute('y',String((above?top-24-(lines.length-1)*20:bottom+42)+i*20));text.setAttribute('fill','#e8e9ef');text.setAttribute('font-family','Arial, sans-serif');text.setAttribute('font-size',String(size));text.setAttribute('font-weight',i===0?'600':'400');group.append(text);});svg.append(group);
 // Keep dense melodic labels readable: only show labels when they fit a cell.
 const width=group.getBBox().width;if(width>maxWidth){const scale=maxWidth/width;group.setAttribute('transform',`translate(${x} ${above?top-24:bottom+42}) scale(${scale}) translate(${-x} ${-(above?top-24:bottom+42)})`);}
}
