import type { ModuleInstance, ModuleKind } from './store';
export const ELEMENT_LABELS:Record<ModuleKind,string>={text:'Text',annotation:'Annotation',notation:'Notation',keyboard:'Keyboard',harmonic:'Harmony',overhead:'Overhead Camera',overheadVisualizer:'Overhead Camera with Visualizer',camera:'Camera'};
export const elementName=(m:Pick<ModuleInstance,'kind'|'name'>)=>m.name||ELEMENT_LABELS[m.kind];
export function uniqueElementName(kind:ModuleKind,modules:Pick<ModuleInstance,'kind'|'name'>[],requested=ELEMENT_LABELS[kind]) {
 const base=requested.trim().slice(0,80)||ELEMENT_LABELS[kind],used=new Set(modules.map(m=>elementName(m).toLowerCase()));
 let name=base,index=2;while(used.has(name.toLowerCase()))name=`${base} ${index++}`;return name;
}
