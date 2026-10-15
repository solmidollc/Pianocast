import { linkNamedAnnotations } from './sharedAnnotations';
import { integrateHarmony } from './harmonyMigration';
import { annotationBoard } from '../annotation/surfaces';
import { editsLocked } from '../annotation/connectionLock';
import { create } from 'zustand';
import { useApp,type ModuleInstance, type SceneBackground } from './store';
import { saveActive,useScenes,loadSceneWorkspace,copyScene,type SavedScene } from './sceneLibrary';
import { templateById,type TemplateDefinition } from './templates';
import { annotationDocuments,restoreAnnotationDocuments,subscribeAnnotationChanges,publishPDF } from '../annotation/store';
import { pdfSourcePacket,renderPDFPage } from '../annotation/pdfSource';
import { SCENE_PRESETS } from './scenePresets';
import { emptyInk, type InkDocument } from '../annotation/model';
import { disconnectAnnotation } from '../annotation/peer';
import { recorder,type RecordingOptions } from '../recording/recorder';
export interface Project {
 version:1; id:string;name:string;templateId:string;category:string;createdAt:string;updatedAt:string;
 scenes:SavedScene[];activeId:string;canvasWidth:number;canvasHeight:number;
 key:ReturnType<typeof useApp.getState>['key'];transitionMode:'move'|'fade'|'dissolve';transitionSeconds:number;
 annotations:Record<string,InkDocument>;pdfs:Record<string,NonNullable<ReturnType<typeof pdfSourcePacket>>>;recording?:RecordingOptions;
}
interface ProjectsState {projects:Project[];activeId:string|null;status:'saved'|'saving'|'error';error:string;ready:boolean;username:string}
export const useProjects=create<ProjectsState>(()=>({projects:[],activeId:null,status:'saved',error:'',ready:false,username:readName()}));
function readName(){try{return localStorage.getItem('piano-canva.username')||'Creator';}catch{return 'Creator';}}
export function setUsername(name:string){const username=name.trim()||'Creator';useProjects.setState({username});try{localStorage.setItem('piano-canva.username',username);}catch{}}
let database:Promise<IDBDatabase>|undefined;
function db(){return database??=(new Promise<IDBDatabase>((resolve,reject)=>{
 const request=indexedDB.open('piano-canva.projects',1);
 request.onupgradeneeded=()=>request.result.createObjectStore('projects',{keyPath:'id'});
 request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
}));}
async function transact<T>(mode:IDBTransactionMode,operation:(store:IDBObjectStore)=>IDBRequest<T>):Promise<T>{
 const database=await db();return new Promise((resolve,reject)=>{const tx=database.transaction('projects',mode),request=operation(tx.objectStore('projects'));tx.oncomplete=()=>resolve(request.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
}
let saving=false,hydrating=false,timer:ReturnType<typeof setTimeout>|undefined,writeChain:Promise<unknown>=Promise.resolve();
function upsert(p:Project){useProjects.setState(s=>({projects:[p,...s.projects.filter(old=>old.id!==p.id)].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))}));}
function boards(scenes:SavedScene[]){return [...new Set(scenes.flatMap(s=>(s.modules??[]).map(annotationBoard).filter((board):board is string=>!!board)))];}
let initialization:Promise<void>|undefined;
export function initializeProjects(){return initialization??=initialize();}
async function initialize(){try{
 const projects=await transact<Project[]>('readonly',s=>s.getAll());
 if(!projects.length && !localStorage.getItem('piano-canva.projects.migrated') && sessionStorage.getItem('pk.scenes.v1')) {
   const library=useScenes.getState();
   if(library.scenes.some(s=>s.modules!==null)) {
     const scenes=structuredClone(library.scenes).slice(0,9).map(scene=>({...scene,modules:scene.modules??SCENE_PRESETS.find(d=>d.id===scene.id)?.build(1920,1080).map((m,i)=>({...m,id:crypto.randomUUID(),z:i+1}))??[]}));
     const app=useApp.getState(),date=new Date().toISOString(),ids=boards(scenes);
     const recovered:Project={version:1,id:'recovered-session-'+crypto.randomUUID(),name:'Recovered session',templateId:'recovered',category:'tutorial',createdAt:date,updatedAt:date,scenes,activeId:library.activeId,canvasWidth:app.canvasWidth,canvasHeight:app.canvasHeight,key:app.key,transitionMode:app.transitionMode,transitionSeconds:app.transitionSeconds,annotations:annotationDocuments(ids),pdfs:Object.fromEntries(ids.map(id=>[id,pdfSourcePacket(id)]).filter(([,p])=>!!p)) as Project['pdfs']};
     await transact('readwrite',s=>s.put(recovered));projects.push(recovered);
   }
 }
 try{localStorage.setItem('piano-canva.projects.migrated','1');}catch{}
 useProjects.setState({projects:projects.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)),ready:true});
}catch(e){failure(e);useProjects.setState({ready:true});}}
function failure(error:unknown){useProjects.setState({status:'error',error:'Could not save projects on this device. '+(error instanceof Error?error.message:String(error))});}
function currentSnapshot():Project|null {
 const state=useProjects.getState(),old=state.projects.find(p=>p.id===state.activeId);if(!old)return null;
 saveActive();
 const app=useApp.getState(),library=useScenes.getState(),ids=boards(library.scenes);
 return {...old,updatedAt:new Date().toISOString(),scenes:structuredClone(library.scenes),activeId:library.activeId,canvasWidth:app.canvasWidth,canvasHeight:app.canvasHeight,key:structuredClone(app.key),transitionMode:app.transitionMode,transitionSeconds:app.transitionSeconds,annotations:{...old.annotations,...annotationDocuments(ids)},pdfs:Object.fromEntries([...Object.entries(old.pdfs??{}),...ids.map(id=>[id,pdfSourcePacket(id)??old.pdfs[id]])].filter(([,p])=>!!p)),recording:structuredClone(recorder.getSnapshot().options)} as Project;
}
export async function saveProject():Promise<boolean> {
 clearTimeout(timer);if(hydrating)return false;
 if(useApp.getState().transitioning)await new Promise<void>(resolve=>{const unsubscribe=useApp.subscribe(state=>{if(!state.transitioning){unsubscribe();resolve();}});});
 saving=true;
 const project=currentSnapshot();if(!project){saving=false;return true;}
 saving=false;upsert(project);useProjects.setState({status:'saving',error:''});
 const write=writeChain.catch(()=>{}).then(()=>transact('readwrite',s=>s.put(project)));writeChain=write;
 try{await write;if(writeChain===write)useProjects.setState({status:'saved'});return true;}catch(e){failure(e);return false;}finally{saving=false;}
}
function schedule(){if(hydrating||saving||!useProjects.getState().activeId||useApp.getState().transitioning)return;if(useProjects.getState().status!=='saving')useProjects.setState({status:'saving'});clearTimeout(timer);timer=setTimeout(()=>void saveProject(),650);}
useApp.subscribe((s,old)=>{if(s.modules!==old.modules||s.background!==old.background||s.key!==old.key||s.transitionSeconds!==old.transitionSeconds||s.transitionMode!==old.transitionMode||old.transitioning&&!s.transitioning)schedule();});
useScenes.subscribe(()=>schedule());subscribeAnnotationChanges(schedule);
export function makeScene(template:TemplateDefinition,definitionId:string,width=1920,height=1080):SavedScene {
 const definition=template.scenes.find(s=>s.id===definitionId)!;
 const modules=definition.build(width,height).map((m,i)=>{const id=crypto.randomUUID();return {...m,id,z:m.kind==='text'?200+i:m.kind==='camera'?100+i:i+1,options:{...m.options,...(m.kind==='annotation'?{boardId:crypto.randomUUID()}: {})}};});
 const keyboard=modules.find(m=>m.kind==='keyboard'),overhead=modules.find(m=>m.kind==='overhead');if(keyboard&&overhead&&keyboard.z<overhead.z)[keyboard.z,overhead.z]=[overhead.z,keyboard.z];
 return {id:definition.id+'-'+crypto.randomUUID(),name:definition.name,shortcut:'',modules,background:{type:'solid',color:'#0C0D10'}};
}
export async function createProject(templateId:string,sceneIds:string[],blank:boolean,name:string,choices?:{templateId:string;sceneId:string}[]):Promise<boolean>{
 const template=templateById(templateId);let scenes=blank?[{id:crypto.randomUUID(),name:'Blank scene',shortcut:'1',modules:[] as ModuleInstance[],background:{type:'solid',color:'#0C0D10'} as SceneBackground}]:choices?.length?choices.slice(0,9).map(choice=>makeScene(templateById(choice.templateId),choice.sceneId)):sceneIds.map(id=>makeScene(template,id));
 scenes=linkNamedAnnotations(scenes);
 if(!scenes.length)return false;scenes.forEach((s,i)=>s.shortcut=String(i+1));
 const date=new Date().toISOString();const project:Project={version:1,id:crypto.randomUUID(),name:name.trim()||template.name,templateId,category:template.category,createdAt:date,updatedAt:date,scenes,activeId:scenes[0].id,canvasWidth:1920,canvasHeight:1080,key:useApp.getState().key,transitionMode:useApp.getState().transitionMode,transitionSeconds:useApp.getState().transitionSeconds,annotations:defaultAnnotations(scenes),pdfs:{}};
 try{await transact('readwrite',s=>s.put(project));upsert(project);await openProject(project.id);return true;}catch(e){failure(e);return false;}
}
export async function openProject(id:string){if(useProjects.getState().activeId && !await saveProject())return false;const project=useProjects.getState().projects.find(p=>p.id===id);if(!project)return false;
 hydrating=true;clearTimeout(timer);disconnectAnnotation();
 try{
  useApp.setState({canvasWidth:project.canvasWidth,canvasHeight:project.canvasHeight,key:structuredClone(project.key),transitionMode:project.transitionMode,transitionSeconds:project.transitionSeconds});
  const sharedScenes=linkNamedAnnotations(project.scenes,board=>project.annotations?.[board]);
  loadSceneWorkspace(sharedScenes.map(scene=>({...scene,modules:scene.modules?integrateHarmony(scene.modules,project.templateId==='classical-tutorial'?'roman':'chord'):null})),project.activeId);restoreAnnotationDocuments(project.annotations??{});for(const packet of Object.values(project.pdfs??{}))publishPDF(packet.board,packet);
  const active=sharedScenes.find(scene=>scene.id===project.activeId);
  await Promise.all((active?.modules??[]).filter(m=>annotationBoard(m)).map(async m=>{const board=annotationBoard(m)!,pdf=project.annotations?.[board]?.pdf;if(pdf&&project.pdfs?.[board])await renderPDFPage(board,pdf.index);}));
  if(project.recording)recorder.setOptions(project.recording);
  useProjects.setState({activeId:id,status:'saved',error:''});return true;
 }catch(e){failure(e);return false;}finally{hydrating=false;}
}
export async function closeProject(){if(!await saveProject())return false;disconnectAnnotation();useProjects.setState({activeId:null});return true;}
export async function renameProject(id:string,name:string){if(!name.trim())return;if(useProjects.getState().activeId===id)await saveProject();const p=useProjects.getState().projects.find(p=>p.id===id);if(!p)return;const next={...p,name:name.trim(),updatedAt:new Date().toISOString()};try{await transact('readwrite',s=>s.put(next));upsert(next);}catch(e){failure(e);}}
export async function duplicateProject(id:string){if(useProjects.getState().activeId===id && !await saveProject())return;
 const source=useProjects.getState().projects.find(p=>p.id===id);if(!source)return;const next=structuredClone(source),map=new Map<string,string>();
 next.scenes=source.scenes.map(scene=>{const clone=copyScene(scene,scene.name,map);clone.shortcut=scene.shortcut;scene.modules?.forEach((m,i)=>{const old=annotationBoard(m),board=annotationBoard(clone.modules![i]);if(old&&board)map.set(old,board);});return clone;});
 next.activeId=next.scenes[source.scenes.findIndex(s=>s.id===source.activeId)]?.id??next.scenes[0].id;
 next.annotations=Object.fromEntries(Object.entries(next.annotations??{}).map(([id,doc])=>[map.get(id)??id,doc]));next.pdfs=Object.fromEntries(Object.entries(next.pdfs??{}).map(([id,p])=>{const board=map.get(id)??id;return [board,{...p,board}];}));
 next.id=crypto.randomUUID();next.name+=' copy';next.createdAt=next.updatedAt=new Date().toISOString();try{await transact('readwrite',s=>s.put(next));upsert(next);}catch(e){failure(e);}
}
export async function deleteProject(id:string){try{await transact('readwrite',s=>s.delete(id));useProjects.setState(s=>({projects:s.projects.filter(p=>p.id!==id)}));}catch(e){failure(e);}}
export function duplicateSceneWithInk(id:string){if(editsLocked()||useScenes.getState().scenes.length>=9)return;saveActive();const source=useScenes.getState().scenes.find(s=>s.id===id);if(!source)return;const clone=copyScene(source,source.name+' copy');source.modules?.forEach((m,i)=>{const old=annotationBoard(m),board=annotationBoard(clone.modules![i]);if(!old||!board)return;restoreAnnotationDocuments({[board]:annotationDocuments([old])[old]});const pdf=pdfSourcePacket(old);if(pdf)publishPDF(board,{...pdf,board});});useScenes.getState().addScene(clone);}
window.addEventListener('pagehide',()=>{void saveProject();});

export function defaultAnnotations(scenes:SavedScene[]):Record<string,InkDocument>{return Object.fromEntries(scenes.flatMap(scene=>(scene.modules??[]).filter(m=>m.kind==='annotation').map(m=>[String(m.options.boardId??m.id),{...emptyInk().document,width:m.width,height:m.height,background:m.options.background==='white'?'white':'transparent'}])));}
export function addLibraryScene(templateId:string,sceneId:string){if(editsLocked())return;if(useScenes.getState().scenes.length>=9)return;const app=useApp.getState(),scene=makeScene(templateById(templateId),sceneId,app.canvasWidth,app.canvasHeight);scene.modules=scene.modules?.map((m,index)=>{if(!['notation','keyboard'].includes(m.kind))return m;
 const ordinal=scene.modules!.slice(0,index+1).filter(other=>other.kind===m.kind).length-1;
 const candidates=[app.modules,...useScenes.getState().scenes.map(s=>s.modules??[])];
 const shared=candidates.map(modules=>modules.filter(other=>other.kind===m.kind)[ordinal]).find(other=>other?.options.annotationBoardId);
 return shared?{...m,options:{...m.options,annotationBoardId:shared.options.annotationBoardId,annotationLabel:shared.options.annotationLabel}}:m;
})??null;const linked=linkNamedAnnotations([...useScenes.getState().scenes,scene],board=>annotationDocuments([board])[board])[useScenes.getState().scenes.length];const existing=new Set(boards(useScenes.getState().scenes));restoreAnnotationDocuments(Object.fromEntries(Object.entries(defaultAnnotations([linked])).filter(([id])=>!existing.has(id))));useScenes.getState().addScene(linked);}



export function renameElement(id:string,name:string){
 if(editsLocked())return;const m=useApp.getState().modules.find(m=>m.id===id);if(!m)return;
 if(m.kind==='annotation'&&name.trim()&&(m.name??'Annotation').trim().toLowerCase()!==name.trim().toLowerCase()){
  const old=String(m.options.boardId??m.id),board=crypto.randomUUID();restoreAnnotationDocuments({[board]:annotationDocuments([old])[old]});const pdf=pdfSourcePacket(old);if(pdf)publishPDF(board,{...pdf,board});
  useApp.getState().updateModule(id,{name,options:{...m.options,boardId:board}});
 }else useApp.getState().updateModule(id,{name});
}
