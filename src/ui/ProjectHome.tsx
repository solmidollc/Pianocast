import { X } from 'lucide-react';
import { AppHeader } from './AppHeader';
import { Circle, Radio, Clapperboard } from 'lucide-react';
import { formatProjectRecency, mostRecentFirst, projectRecency } from '../state/projectRecency';
import { MAX_SCENES } from '../state/sceneLibrary';
import { createVideoEdit, openVideoEdit, refreshEdits, useVideoEdits, type EditSummary } from '../editing/store';
import { GettingStarted } from './GettingStarted';
import { useDialogKeyboard } from './useDialogKeyboard';
import { useEffect, useState } from 'react';
import { templateById } from '../state/templates';
import { createProject,openProject,renameProject,duplicateProject,deleteProject,useProjects,type Project } from '../state/projects';
import { ScenePreview } from './ScenePreview';
import { type StudioTheme } from './StudioView';
export function ProjectHome({onOpen,theme,onTheme}:{onOpen:()=>void;theme:StudioTheme;onTheme:(v:StudioTheme)=>void}){
 const {projects,username,ready,error}=useProjects();
 const edits=useVideoEdits(s=>s.library);
 useEffect(()=>{void refreshEdits();},[]);
 const recent=[...projects.map(p=>({id:p.id,name:p.name,updatedAt:p.updatedAt,lastOpenedAt:p.lastOpenedAt,edit:false})),...edits.map(p=>({id:p.id,name:p.title,updatedAt:p.updatedAt,lastOpenedAt:p.lastOpenedAt,edit:true}))].sort(mostRecentFirst);
 const [page,setPage]=useState<'home'|'help'|'projects'|'templates'>('home');
 const [intent,setIntent]=useState<'record'|'livestream'>('record');
 const [selection,setSelection]=useState<{templateId:string;sceneId:string}[]>([]),[name,setName]=useState(''),[preview,setPreview]=useState<{templateId:string;sceneId:string}|null>(null),[busy,setBusy]=useState(false);
 useDialogKeyboard(!!preview,'Scene preview',()=>setPreview(null));
 const templateId=selection[0]?.templateId??(intent==='record'?'classical-tutorial':'livestream');
 const previewScene=preview?templateById(preview.templateId).scenes.find(s=>s.id===preview.sceneId):null;
 const goOpen=async(id:string)=>{setBusy(true);try{if(await openProject(id))onOpen();}finally{setBusy(false);}};
 const create=async(blank=false,source=templateId)=>{setBusy(true);try{if(await createProject(source,[],blank,blank?'Untitled project':name,selection))onOpen();}finally{setBusy(false);}};
 const back=()=>setPage('home');
 const toggle=(templateId:string,sceneId:string)=>setSelection(old=>old.some(s=>s.templateId===templateId&&s.sceneId===sceneId)?old.filter(s=>s.templateId!==templateId||s.sceneId!==sceneId):old.length<MAX_SCENES?[...old,{templateId,sceneId}]:old);
 const begin=(value:'record'|'livestream')=>{setIntent(value);setSelection([]);setName('');setPage('templates');};
 return <main data-theme={theme} className={'project-home h-full bg-ink-950 text-ink-100 font-sans '+(page==='templates'?'scene-picker-home':page==='home'?'welcome-home overflow-y-auto':'overflow-y-auto')}>
 <AppHeader theme={theme} onTheme={onTheme} onHome={()=>setPage('home')} disabled={busy}/>
 <div className={'project-home-body '+(page==='home'?'project-welcome-body':page==='templates'?'scene-picker-body':'')}>
 {page!=='home'&&<button className="project-back" onClick={back}>← Back</button>}
 {busy&&<p role="status" className="project-storage-note">Opening project…</p>}
 {error&&<p role="alert" className="project-error">{error}</p>}
 {!ready?<p role="status">Loading projects…</p>:page==='home'?<>
 <section className="project-welcome-main"><div className="project-welcome-greeting"><h1>Hi, {username}!</h1><p className="project-subtitle">What would you like to create today?</p></div>
 <div className="project-options project-start-options"><HomeCard title="Record" icon="record" onClick={()=>begin('record')}/><HomeCard title="Livestream" icon="live" onClick={()=>begin('livestream')}/><HomeCard title="Edit" icon="edit" onClick={()=>void createVideoEdit()}/></div>
 </section><div className="project-welcome-support"><button className="project-secondary project-getting-started" onClick={()=>setPage('help')}>Getting Started <span>Cameras, music and recording</span></button></div>
 {recent.length>0&&<section className="project-recent" aria-label="Recent projects"><div className="project-recent-heading"><h2>Recent projects</h2><button onClick={()=>setPage('projects')}>My projects →</button></div><div className="project-recent-list">{recent.slice(0,3).map(project=><button disabled={busy} key={project.id} onClick={()=>void (project.edit?openVideoEdit(project.id):goOpen(project.id))}><span>{project.name}{project.edit?' · Score Sync':''}</span><time dateTime={projectRecency(project)} title={new Date(projectRecency(project)).toLocaleString()}>{formatProjectRecency(projectRecency(project))}</time></button>)}</div></section>}

 </>:page==='help'?<><h1>Getting started</h1><div className="project-help"><GettingStarted/><button className="project-primary" onClick={()=>begin('record')}>Choose scenes</button></div></>:page==='projects'?<><h1>My projects</h1><p className="project-subtitle">Your saved work on this device.</p>{recent.length>0&&<ProjectList projects={projects} edits={edits} onOpen={goOpen} busy={busy}/>}{!recent.length&&<div className="project-help"><p>No projects yet. Create your first project to get started.</p><button className="project-primary" onClick={()=>begin('record')}>Templates</button><button className="project-secondary" onClick={()=>setPage('help')}>Getting Started</button></div>}</>:<><div className="project-scene-heading"><h1>{intent==='record'?'Record':'Livestream'}</h1><button className="project-secondary" disabled={busy} onClick={()=>void create(true,intent==='record'?'classical-tutorial':'livestream')}>Start from scratch</button></div>
 <p className="project-subtitle project-scene-intro">Choose up to three scenes.</p><SceneChooser key={intent} intent={intent} selection={selection} busy={busy} onToggle={toggle} onPreview={(templateId,sceneId)=>setPreview({templateId,sceneId})}/>

 <div className="project-create-bar project-direct-create"><label>Project name<input aria-label="Project name" value={name} placeholder="Untitled project" onChange={e=>setName(e.target.value)} maxLength={100}/></label><span role="status">{selection.length ? `${selection.length} of ${MAX_SCENES} scenes selected` : 'Select a scene to continue'}</span><button className="project-primary" disabled={busy||!selection.length} onClick={()=>void create()}>{busy?'Creating…':'Create project'}</button></div>
 </>}

 </div>
 {previewScene&&<div className="project-modal-backdrop" onClick={()=>setPreview(null)}><section role="dialog" aria-modal="true" aria-label="Scene preview" className="project-modal" onClick={e=>e.stopPropagation()}><div className="project-modal-heading"><h2>{previewScene.name}</h2><button aria-label="Close preview" onClick={()=>setPreview(null)}><X size={16} aria-hidden="true"/></button></div><ScenePreview scoreSync={previewScene.scoreSync} modules={previewScene.build(1920,1080)}/><p>Layout preview. Assign your cameras in the editor.</p></section></div>}
 </main>;
}
function SceneChooser({intent,selection,busy,onToggle,onPreview}:{intent:'record'|'livestream';selection:{templateId:string;sceneId:string}[];busy:boolean;onToggle:(template:string,scene:string)=>void;onPreview:(template:string,scene:string)=>void}) {
 const [category,setCategory]=useState(intent==='record'?'tutorial':'livestream');
 const categories=intent==='record'?[{id:'tutorial',name:'Tutorial'},{id:'performance',name:'Performance'}]:[{id:'livestream',name:'Livestream'},{id:'presentation',name:'Presentation'}];
 const ids=category==='tutorial'?['classical-tutorial','jazz-tutorial']:category==='performance'?['studio-recording','entertainer','performance-spotlight']:category==='presentation'?['in-person','online-meeting']:[category];
 return <section className="scene-chooser"><nav className="scene-category-tabs" aria-label="Scene categories">{categories.map(item=><button key={item.id} aria-pressed={category===item.id} onClick={()=>setCategory(item.id)}>{item.name}</button>)}</nav>
 <div className={'scene-chooser-content scene-category-'+category}>
 {ids.map(id=>{const template=templateById(id);return <section className="scene-chooser-family" key={id}><div className="scene-family-description">{(category==='tutorial'||ids.length===1)&&<><h3>{template.name}</h3><p>{template.description}</p></>}</div><div className="scene-chooser-grid">{template.scenes.map(scene=>{
 const order=selection.findIndex(item=>item.templateId===id&&item.sceneId===scene.id);
 return <article key={scene.id} className={'project-selection-card '+(order>=0?'is-selected':'')}><button disabled={busy||selection.length>=MAX_SCENES&&order<0} className="project-select-layout" aria-pressed={order>=0} aria-label={'Select '+template.name+' — '+scene.name} onClick={()=>onToggle(id,scene.id)}><ScenePreview modules={scene.build(1920,1080)} scoreSync={scene.scoreSync}/><div className="project-card-title"><h4>{scene.name}</h4><span className="project-selection-indicator">{order>=0?order+1:'＋'}</span></div></button>{scene.restriction&&<p className="scene-availability">{scene.restriction}</p>}{scene.scoreSync&&<p className="scene-availability">Uses Score Sync · record first</p>}<button disabled={busy} className="project-preview-button" aria-label={'Preview '+template.name+' — '+scene.name} onClick={()=>onPreview(id,scene.id)}>Preview</button></article>;
 })}</div></section>;})}</div></section>;
}

function HomeCard({title,icon,onClick}:{title:string;icon:'record'|'live'|'edit';onClick:()=>void}){
 const Icon=icon==='record'?Circle:icon==='live'?Radio:Clapperboard;
 return <button className={'project-home-card welcome-action welcome-action-'+icon} onClick={onClick}><span className="welcome-action-icon" aria-hidden="true"><Icon size={34} strokeWidth={1.6} fill={icon==='record'?'currentColor':'none'}/></span><h2>{title}</h2></button>;
}

function ProjectList({projects,edits,onOpen,busy}:{projects:Project[];edits:EditSummary[];onOpen:(id:string)=>void;busy:boolean}){
 const items=[...projects.map(data=>({kind:'scene' as const,data})),...edits.map(data=>({kind:'edit' as const,data}))].sort((a,b)=>mostRecentFirst(a.data,b.data));
 const [rename,setRename]=useState<string|null>(null),[name,setName]=useState(''),[deleting,setDeleting]=useState<string|null>(null);
 useDialogKeyboard(!!rename,'Rename project',()=>setRename(null));
 useDialogKeyboard(!!deleting,'Delete project',()=>setDeleting(null));
 return <><div className="project-list">{items.map(item=>{if(item.kind==='edit'){const edit=item.data;return <article className="project-list-item" key={edit.id}><button disabled={busy} className="project-open" onClick={()=>void openVideoEdit(edit.id)}><span><strong>{edit.title}</strong><small>Edit · {formatProjectRecency(projectRecency(edit))}</small></span></button></article>;}const p=item.data;const scene=p.scenes.find(s=>s.id===p.activeId)??p.scenes[0];return <article className="project-list-item" key={p.id}><button disabled={busy} className="project-open" onClick={()=>onOpen(p.id)}><div className="project-list-preview"><ScenePreview modules={scene.modules??[]} width={p.canvasWidth} height={p.canvasHeight}/></div><span><strong>{p.name}</strong><small>{templateById(p.templateId)?.name??'Custom project'} · {formatProjectRecency(projectRecency(p))}</small></span></button><div className="project-actions"><button aria-label={'Rename '+p.name} onClick={()=>{setRename(p.id);setName(p.name);}}>Rename</button><button aria-label={'Duplicate '+p.name} onClick={()=>void duplicateProject(p.id)}>Duplicate</button><button aria-label={'Delete '+p.name} onClick={()=>setDeleting(p.id)}>Delete</button></div></article>;})}</div>
 {rename&&<div className="project-modal-backdrop"><form className="project-modal project-small-modal" role="dialog" aria-modal="true" aria-label="Rename project" onSubmit={e=>{e.preventDefault();void renameProject(rename,name);setRename(null);}}><h2>Rename project</h2><input aria-label="Project name" value={name} maxLength={100} onChange={e=>setName(e.target.value)}/><button className="project-primary" disabled={!name.trim()}>Save</button><button className="project-secondary" type="button" onClick={()=>setRename(null)}>Cancel</button></form></div>}
 {deleting&&<div className="project-modal-backdrop"><section className="project-modal project-small-modal" role="dialog" aria-modal="true" aria-label="Delete project"><h2>Delete project?</h2><p>“{projects.find(p=>p.id===deleting)?.name}” and its saved scenes will be removed from this device. This cannot be undone.</p><button className="project-danger" onClick={()=>{void deleteProject(deleting);setDeleting(null);}}>Delete project</button><button className="project-secondary" onClick={()=>setDeleting(null)}>Cancel</button></section></div>}</>;
}

