import { useEffect,useLayoutEffect,useRef,useState } from 'react';
import { useApp,type ModuleInstance } from '../state/store';
import { useScenes } from '../state/sceneLibrary';
import { KeyboardModule } from '../modules/Keyboard';
import { NotationModule } from '../modules/Notation';
import { MelodicNotationModule } from '../modules/MelodicNotation';
import { annotationBoard,publishSurfaceCatalog,type AnnotationSurface } from './surfaces';
import { useAnnotationLink } from './peer';
import { dispatchInk } from './store';
export function AnnotationSurfaceBridge(){
 const status=useAnnotationLink(s=>s.status),host=useAnnotationLink(s=>s.board);
 const enabled=!!host&&['Preparing connection','Waiting for return code','Waiting for device','Connecting','Connected'].includes(status)&&!new URLSearchParams(location.search).has('mode');
 const [layout,setLayout]=useState<{modules:ModuleInstance[];scene:string}>({modules:[],scene:''});
 useEffect(()=>{
  if(!enabled)return;
  const update=()=>{const app=useApp.getState();if(app.transitioning)return;
   const library=useScenes.getState();setLayout({modules:app.modules.filter(m=>m.visible&&annotationBoard(m)),scene:library.scenes.find(s=>s.id===library.activeId)?.name??'Scene'});
  };
  update();return useApp.subscribe((state,old)=>{if(state.modules!==old.modules||state.key!==old.key||old.transitioning&&!state.transitioning)update();});
 },[enabled,status]);
 const root=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{
  if(!enabled)return;
  const frame=requestAnimationFrame(()=>{
   const surfaces:AnnotationSurface[]=[];
   for(const [index,m] of layout.modules.entries()){
    const ordinal=layout.modules.slice(0,index+1).filter(other=>other.kind===m.kind).length;
    const board=annotationBoard(m)!;if(surfaces.some(s=>s.board===board))continue;
    dispatchInk(board,{type:'dimensions',width:m.width,height:m.height});
    const surface:AnnotationSurface={board,label:String(m.options.annotationLabel??(m.kind==='annotation'?'Whiteboard / PDF '+ordinal:m.kind==='notation'?'Staff':'Keyboard')).slice(0,160),kind:m.kind as AnnotationSurface['kind'],width:m.width,height:m.height};
    const original=root.current?.querySelector(`[data-reference-index="${index}"] svg`);
    if(original){
     const copy=original.cloneNode(true) as SVGElement;
     const nodes=[original,...Array.from(original.querySelectorAll('*'))],clones=[copy,...Array.from(copy.querySelectorAll('*'))];
     clones.forEach((node,i)=>{const style=getComputedStyle(nodes[i]);for(const key of ['fill','stroke','stroke-width','font-family','font-size','font-weight'])node.setAttribute(key,style.getPropertyValue(key));});
     copy.setAttribute('xmlns','http://www.w3.org/2000/svg');
     surface.reference='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(copy));
    }
    surfaces.push(surface);
   }
   publishSurfaceCatalog({kind:'surfaces',scene:layout.scene,surfaces});
  });return()=>cancelAnimationFrame(frame);
 },[layout,enabled]);
 if(!enabled)return null;
 return <div ref={root} aria-hidden="true" style={{position:'fixed',left:-20000,top:0,pointerEvents:'none',visibility:'hidden'}}>{layout.modules.map((m,index)=>{
  const opts=m.options as any,Notation=opts.notationMode==='melodic'?MelodicNotationModule:NotationModule;
  return <div key={m.id} data-reference-index={index} style={{width:m.width,height:m.height}}>{m.kind==='keyboard'?<KeyboardModule width={m.width} height={m.height} rangeLow={opts.range?.[0]} rangeHigh={opts.range?.[1]} staticPreview/>:m.kind==='notation'?<Notation width={m.width} height={m.height} baseWidth={m.baseWidth} baseHeight={m.baseHeight} range={opts.range} style={opts.style} trebleOttava={opts.trebleOttava} bassOttava={opts.bassOttava} staticPreview/>:null}</div>;
 })}</div>;
}
