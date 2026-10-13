import { useState } from 'react';
import { useApp } from '../state/store';
import { TEMPLATES,templateById } from '../state/templates';
import { MAX_SCENES,useScenes } from '../state/sceneLibrary';
import { addLibraryScene,useProjects } from '../state/projects';
import { ScenePreview } from './ScenePreview';
export function SceneLibraryDialog({onClose,onAdded}:{onClose:()=>void;onAdded?:()=>void}){
 const width=useApp(s=>s.canvasWidth),height=useApp(s=>s.canvasHeight);
 const p=useProjects(s=>s.projects.find(p=>p.id===s.activeId));
 const [templateId,setTemplate]=useState(p?.templateId==='recovered'?'jazz-tutorial':p?.templateId??'jazz-tutorial');
 const scenes=useScenes(s=>s.scenes),template=templateById(templateId),full=scenes.length>=MAX_SCENES;
 return <div className="project-modal-backdrop" onClick={onClose}><section role="dialog" aria-modal="true" aria-label="Scene library" className="project-modal project-library" onClick={e=>e.stopPropagation()}><div className="project-modal-heading"><h2>Add a scene</h2><button autoFocus aria-label="Close scene library" onClick={onClose}>×</button></div><div className="project-library-controls"><label>Template<select aria-label="Scene library template" value={templateId} onChange={e=>setTemplate(e.target.value)}>{TEMPLATES.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label><button className="project-secondary" disabled={full} onClick={()=>{useScenes.getState().createBlank('Blank scene');onAdded?.();onClose();}}>Blank scene</button></div><div className="project-template-grid">{template.scenes.map(scene=><button className="project-template-card" disabled={full} key={scene.id} onClick={()=>{addLibraryScene(templateId,scene.id);onAdded?.();onClose();}}><ScenePreview modules={scene.build(width,height)} width={width} height={height}/><h2>{scene.name}</h2><p>{scene.description}</p></button>)}</div><p>{full?'Your project has 9 scenes. Remove one before adding another.':`${scenes.length} of 9 scenes used`}</p></section></div>;
}
