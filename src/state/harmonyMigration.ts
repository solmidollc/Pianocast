import type { ModuleInstance } from './store';
import { uniqueElementName } from './elementNames';
type Element=Omit<ModuleInstance,'id'|'z'> & {id?:string;z?:number};
export function integrateHarmony<T extends Element>(elements:T[],defaultMode='chord'):T[] {
 const legacy=elements.filter(m=>m.kind==='harmonic'),result=elements.filter(m=>m.kind!=='harmonic').map(m=>({...m,options:{...m.options}}));
 const staffCount=result.filter(m=>m.kind==='notation').length;
 for(let index=staffCount;index<legacy.length;index++){
  const old=legacy[index];result.push({...old,kind:'notation',width:Math.max(240,old.width),height:Math.max(340,old.height),baseWidth:Math.max(240,old.width),baseHeight:Math.max(340,old.height),options:{}} as T);
 }
 result.filter(m=>m.kind==='notation').forEach((m,index)=>{const old=legacy[index]??legacy[0];if(m.options.harmonyMode===undefined)m.options.harmonyMode=old?(old.options.mode==='nashville'?'roman':defaultMode==='roman'&&(!old.options.mode||old.options.mode==='chord')?'roman':old.options.mode??defaultMode):defaultMode;if(old){m.options.harmonyEnabled??=old.visible;m.options.harmonyIntervals??=old.options.showIntervals??true;}});
 const named:T[]=[];for(const m of result){m.name=uniqueElementName(m.kind,named,m.name);named.push(m);}return named;
}
