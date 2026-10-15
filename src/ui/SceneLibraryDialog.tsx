import { useDialogKeyboard } from './useDialogKeyboard';
import { useState } from 'react';
import { useApp } from '../state/store';
import { templateById } from '../state/templates';
import { MAX_SCENES,useScenes } from '../state/sceneLibrary';
import { addLibraryScene,useProjects } from '../state/projects';
import { ScenePreview } from './ScenePreview';
const groups=[{id:'lesson',name:'Lesson',ids:['classical-tutorial','jazz-tutorial']},{id:'performance',name:'Performance',ids:['studio-recording','entertainer','performance-spotlight']},{id:'live',name:'Livestream',ids:['livestream']},{id:'presentation',name:'Presentation',ids:['in-person','online-meeting']}];
export function SceneLibraryDialog({onClose,onAdded}:{onClose:()=>void;onAdded?:()=>void}){
 useDialogKeyboard(true,'Scene library',onClose);
 const width=useApp(s=>s.canvasWidth),height=useApp(s=>s.canvasHeight);
 const p=useProjects(s=>s.projects.find(p=>p.id===s.activeId));
 const [category,setCategory]=useState(groups.find(g=>g.ids.includes(p?.templateId??''))?.id??'lesson');
 const scenes=useScenes(s=>s.scenes),full=scenes.length>=MAX_SCENES,group=groups.find(g=>g.id===category)!;
 return <div className="project-modal-backdrop" onClick={onClose}><section role="dialog" aria-modal="true" aria-label="Scene library" className="project-modal project-library" onClick={e=>e.stopPropagation()}><div className="project-modal-heading"><h2>Add a scene</h2><button aria-label="Close scene library" onClick={onClose}>×</button></div><div className="scene-library-layout"><nav aria-label="Scene categories" className="scene-library-nav">{groups.map(g=><button key={g.id} aria-pressed={g.id===category} onClick={()=>setCategory(g.id)}>{g.name}</button>)}<button className="scene-library-blank" disabled={full} onClick={()=>{useScenes.getState().createBlank('New scene');onAdded?.();onClose();}}>Blank scene</button></nav><div className="scene-library-content">{group.ids.map(id=>{const template=templateById(id);return <section key={id}>{template.scenes.length>1&&<h3>{template.name}</h3>}<div className="project-template-grid">{template.scenes.map(scene=><button className="project-template-card" disabled={full} key={scene.id} onClick={()=>{addLibraryScene(id,scene.id);onAdded?.();onClose();}}><ScenePreview modules={scene.build(width,height)} width={width} height={height}/><h2>{scene.name}</h2></button>)}</div></section>;})}</div></div><p className="scene-library-count">{full?'Your project has 9 scenes. Remove one before adding another.':`${scenes.length} of 9 scenes used`}</p></section></div>;
}
