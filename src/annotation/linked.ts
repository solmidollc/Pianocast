import { useApp } from '../state/store';
import { useScenes,saveActive } from '../state/sceneLibrary';
import { editsLocked } from './connectionLock';
import { dispatchInk } from './store';
/** The same role/ordinal shares ink across existing scenes; additional modules get separate boards. */
export function enableModuleAnnotation(id:string){
 if(editsLocked())return;
 const app=useApp.getState(),module=app.modules.find(m=>m.id===id);
 if(!module||!['notation','keyboard'].includes(module.kind)||module.options.annotationBoardId)return;
 saveActive();const ordinal=app.modules.filter(m=>m.kind===module.kind).findIndex(m=>m.id===id),board=crypto.randomUUID();
 const options={annotationBoardId:board,annotationLabel:(module.kind==='notation'?'Staff':'Keyboard')+' '+(ordinal+1)};
 useScenes.setState(state=>({scenes:state.scenes.map(scene=>{let index=-1;return {...scene,modules:scene.modules?.map(m=>{
  if(m.kind===module.kind)index++;return m.kind===module.kind&&index===ordinal&&!m.options.annotationBoardId?{...m,options:{...m.options,...options}}:m;
 })??null};})}));
 app.updateModule(id,{options:{...module.options,...options}});
 dispatchInk(board,{type:'dimensions',width:module.width,height:module.height});
}
export function disableModuleAnnotation(id:string){
 if(editsLocked())return;const app=useApp.getState(),module=app.modules.find(m=>m.id===id);if(!module)return;
 const options={...module.options};delete options.annotationBoardId;delete options.annotationLabel;app.updateModule(id,{options});
}
