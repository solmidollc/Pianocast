import { create } from 'zustand';
import type { ModuleInstance } from '../state/store';
export interface AnnotationSurface { board:string; label:string; kind:'annotation'|'notation'|'keyboard'; width:number; height:number; reference?:string }
export interface SurfaceCatalog { kind:'surfaces'; scene:string; surfaces:AnnotationSurface[] }
export const useSurfaceCatalog=create<{scene:string;surfaces:AnnotationSurface[]}>(()=>({scene:'',surfaces:[]}));
const listeners=new Set<(catalog:SurfaceCatalog)=>void>();
export function annotationBoard(m:ModuleInstance):string|undefined {
 return m.kind==='annotation'?String(m.options.boardId??m.id):['notation','keyboard'].includes(m.kind)&&typeof m.options.annotationBoardId==='string'?m.options.annotationBoardId:undefined;
}
export function validSurfaceCatalog(raw:any):raw is SurfaceCatalog {
 return raw?.kind==='surfaces' && typeof raw.scene==='string' && raw.scene.length<=160 && Array.isArray(raw.surfaces) && raw.surfaces.length<=64 && new Set(raw.surfaces.map((s:any)=>s.board)).size===raw.surfaces.length && raw.surfaces.every((s:any)=>typeof s.board==='string'&&s.board.length>0&&s.board.length<=80&&typeof s.label==='string'&&s.label.length<=160&&['annotation','notation','keyboard'].includes(s.kind)&&[s.width,s.height].every(n=>Number.isFinite(n)&&n>=80&&n<=7680)&&(!s.reference||typeof s.reference==='string'&&s.reference.length<=1_000_000&&s.reference.startsWith('data:image/svg+xml;charset=utf-8,')));
}
export function receiveSurfaceCatalog(raw:unknown){if(!validSurfaceCatalog(raw))return false;useSurfaceCatalog.setState({scene:raw.scene,surfaces:raw.surfaces});return true;}
export function publishSurfaceCatalog(catalog:SurfaceCatalog){if(receiveSurfaceCatalog(catalog))listeners.forEach(fn=>fn(catalog));}
export function onSurfaceCatalog(fn:(catalog:SurfaceCatalog)=>void){listeners.add(fn);return()=>{listeners.delete(fn);};}
export function surfaceCatalog():SurfaceCatalog{return {kind:'surfaces',...useSurfaceCatalog.getState()};}
